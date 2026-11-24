# P2P SUPPLIER MANAGEMENT

## Code Walkthrough

**Module:** P2P Supplier Management  
**Menu Path:** Procure to Pay (P2P) → P2P Master Management → Supplier Management  
**Technology Stack:** Laravel, PHP, React, TypeScript, PostgreSQL  
**Backend:** Laravel REST APIs  
**Frontend:** React / TypeScript  
**Document Type:** Code Walkthrough  

---

## CONTENTS

1. Introduction
2. Project File Structure
3. API Routing and Access
4. Common Conventions
5. Feature 1 — Open the Supplier List
6. Feature 2 — Add Supplier: the Domestic / International Chooser
7. Feature 3 — Stage 1: Supplier Identification & Address Details
8. Feature 4 — Stage 1: Contact Person Details
9. Feature 5 — Stage 2: Company Due Diligence, Owner KYC, Trade Licence
10. Feature 6 — Bank Details
11. Feature 7 — GST Scrutiny
12. Feature 8 — Save & Next in Stage 2, and Save / Update Supplier
13. Feature 9 — Edit Supplier and Its Locks
14. Feature 10 — Map Products
15. Feature 11 — Map Services
16. Feature 12 — Supplier Evidence Vault
17. Feature 13 — Compliance Status
18. Feature 14 — Convert to Supplier (from the Sourcing Tracker)
19. Feature 15 — Contact Persons and Segments Popups
20. Design Patterns Used
21. Troubleshooting Guide
22. Complete Flow Summary

---

## 1. INTRODUCTION

### 1.1 Purpose

This document is the guided tour of the Supplier Management code. For every
feature it shows: **which screen → which component and function → which API →
which backend method → which database tables → what comes back → what the
screen does next.**

Read the Functional document first (what the module does for the user) and the
Technical document (architecture and data model). This document connects the two.

### 1.2 How to Read the References

* Code is referenced by **file, function, component or constant name**. Search
  for the name. Line numbers are not given — they change with every edit (all
  backend comments were removed on 23-Nov-2026, which moved every backend line).
* **VC** = `VendorController`, **SDUC** = `SegmentDocUploadController`,
  **SSM** = `App\Services\P2p\ServiceSupplierMapping`.
* Toasts are written *Title — Body*.
* The code is described **as it is in the repository**, including the Supplier
  Behaviour master change (commit `cdc5aff67`) and the product GST block
  (CS-2327, `da7a6d271`).

### 1.3 Module in One Picture

```
Supplier (vendors, S-001 …)
  ├─ Stage 1  Identity + primary address          vendors, vendor_segments, vendor_addresses
  │           Contact persons                     vendor_addresses (primary + extra)
  ├─ Stage 2  Segment documents (DD / KYC / TL)   segment_doc_uploads
  │           Bank accounts                       vendor_bank_accounts
  │           GST scrutiny (domestic)             vendor_gst_scrutiny
  │           Legacy DD / Owner / TL lists        vendor_documents, vendor_owners
  ├─ Mappings Products  (Material/ Goods)         vendor_product_mappings + product_vendor_maps
  │           Services  (eight service types)     p2p_service_suppliers
  ├─ Evidence Vault  (standard docs + PO deals)   segment_doc_uploads, p2p_purchase_order_documents,
  │                                               clm_signature_requests
  └─ Compliance  (computed on every list call)    SupplierCompliance — nothing stored

New Supplier (p2p_suppliers, Sourcing Tracker) ──Convert──► vendors
```

---

## 2. PROJECT FILE STRUCTURE

### 2.1 Backend Files

| File | Responsibility |
|---|---|
| `app/Http/Controllers/Api/VendorController.php` (1948 lines) | **Everything about a supplier**: list, detail, every wizard step, contacts (and the Convert-to-Supplier link in `storeContacts()`), banks, GST scrutiny, product and service mappings, delete, master bundle. There is no `VendorService` — the controller holds the logic |
| `app/Http/Controllers/Api/SegmentDocUploadController.php` (1629) | KYC / DD / TL uploads and the Evidence Vault payload (shared with Customer, Consignee, Product). The unused private `sigDocs()` was removed on 23-Nov-2026 |
| `app/Support/SegmentGuard.php` (468) | Supplier Type lock, segment-in-use checks |
| `app/Support/SupplierCompliance.php` (214) | Compliant / Non Compliant, batched for a whole list |
| `app/Services/SegmentDocScope.php` (63) | Which document codes apply (segment × Domestic / International) |
| `app/Services/P2p/ServiceSupplierMapping.php` (215) | Which Supplier Type may map which service; service pricing |
| `app/Support/SupplierPricing.php` (153) | Product / service price arithmetic and caps |
| `app/Support/MasterVisibility.php` (176) | Tenant / branch read scope; the (open) edit check |
| `app/Support/Gst.php` (75) | GST helpers (used by service pricing) |
| `app/Models/Vendor.php` (160) | Relations, `scopeForUser`, bundle-cache bump, unique-email hook, `$convertingSupplierId` |
| `app/Http/Controllers/Api/P2p/SourcingController.php` (1432) | `convertPrefill()` / `convertSupplier()` (Convert to Supplier) |

Line counts are a size guide only (23-Nov-2026).

### 2.2 Frontend Files

All under `resources/js/pages/p2p/p2p-master-management/supplier-management/`.

**Page**

| File | Responsibility |
|---|---|
| `Vendors.tsx` (1487) | The list: origin and type tabs, search, filter, table, popups, screen-fill (`recompute()`) |

**Popups**

| File | Responsibility |
|---|---|
| `AddVendorModal.tsx` (7311) | The wizard **and** the Mapped Products / Mapped Services popups, `PopupShell`, `PopupChrome`, shared field helpers, `SegmentRefUploadPopup` (also used by the vault) |
| `SupplierScopeGate.tsx` (352) | The Domestic / International chooser |
| `SupplierEvidenceVaultModal.tsx` (2755) | The Evidence Vault and its two overviews |

**Helpers**

| File | Responsibility |
|---|---|
| `serviceMapping.ts` (29) | `serviceBucketOf(typeName)` — Supplier Type → service bucket |
| `vendorBundleCache.ts` (78) | `sessionStorage` cache of the master bundle |
| `resources/js/utils/fieldValidators.ts` (179) | Email, website, GSTIN, TIN, IFSC, SWIFT, account-number validators |
| `resources/js/hooks/useRuledSegments.ts` (44) | `GET /clm/segment-rules` → which segments have a Document Control Panel rule, per origin (DOM / INT badges, greyed-out segments). Shared with the Customer and Consignee forms |
| `resources/js/utils/routeAccess.ts` | `canAccessPath()`: `/suppliers`, `/vendors` → branch user or employee only |

**CSS**

| File | Area |
|---|---|
| `supplier-management.css` | The list |
| `add-vendor-modal.css` | The wizard and its popups |
| `supplier-evidence-vault.css` | The vault (`.spev` = Supplier only; `.sev` / `.cev` are shared) |
| `supplier-scope-gate-teal.css` | The chooser |

### 2.3 Shared Components Used

| Component | From | Used for |
|---|---|---|
| `api` | `resources/js/api` | Axios instance with the Sanctum token |
| `useToast` · `useAuth` · `useConfirm` | `contexts/ToastContext` · `contexts/AuthContext` · `contexts/ConfirmContext` | Toasts; the logged-in user; confirm dialogs |
| `Tooltip` · `WorklistPager` · `Shimmer`, `ShimmerTable` | `components/ui/` | Tooltips, list pager, loading states |
| `useIsClipped` | `components/ui/DataTable` | Tooltip only when a cell is cut |
| `SegmentBadge` (+ `SegmentItemBadge`, `SegmentNameList` …) | `components/ui/SegmentBadge` | Segment names with regulatory badges |
| `MasterSelect` · `MasterDatePicker` · `SearchClear` | `components/ui/` | Dropdowns, date pickers, search box clear |
| `MasterMultiSelect` | `pages/master/masterFormKit` | Supplier Segment multi-select |
| `MasterRecordModal` | `pages/master/MasterRecordModal` | Generic master quick-add (wired, but no field opens it — Section 7) |
| `SegmentModal`, `nextSegmentCode` | `pages/clm/compliance/ClmSegmentPage` | Segment "+" (create a CLM segment) |
| `AuthorityBadges` | `pages/clm/compliance/AuthorityBadges` | Issuing-authority chips on document rows |
| `AttachPicker` | `pages/p2p/procurement-management/sourcing-tracker/AttachPicker` | Upload file / take photo |
| `SalesCustomerSendForSignatureModal` | `pages/sales/core-masters/customer/` | Send for signature (wizard and vault) |
| `SigningTrackerModal` | `pages/sales/opportunity-pipeline/SigningTrackerModal` | Track a signature request (vault) |
| `poDocumentApi` | `pages/p2p/purchase-management/order/api/po-api` | PO document generate / sign (vault) |
| `resolveFileUrl` · `downloadFile` · `formatProductCode` · `lazyPage` | `utils/` | File URLs, downloads, product codes, lazy chunks |
| `signatureRequestsToVaultDocs`, `mergeTradeDocuments` | `utils/vaultSignatureRows` | Signature rows in the vault |
| `useActionLock` | `hooks/useActionLock` | One vault action at a time |
| `useRuledSegments` | `hooks/useRuledSegments` | Segment rule badges |

---

## 3. API ROUTING AND ACCESS

### 3.1 Backend Routes

`routes/api.php`, inside `Route::middleware(['auth:sanctum','user.active','tenant'])`.

```php
// Supplier (VendorController) — right after the /products routes
Route::get   ('/vendors',                          [VendorController::class, 'index']);
Route::get   ('/vendors/master-bundle',            [VendorController::class, 'masterBundle']);
Route::get   ('/vendors/{id}',                     [VendorController::class, 'show']);
Route::get   ('/vendors/{id}/product-mappings',    [VendorController::class, 'productMappings']);
Route::post  ('/vendors/step/identity',            [VendorController::class, 'storeIdentity']);
Route::put   ('/vendors/{id}/step/contacts',       [VendorController::class, 'storeContacts']);
Route::post  ('/vendors/{id}/contacts',            [VendorController::class, 'storeContact']);
Route::put   ('/vendors/{id}/contacts/{contact}',  [VendorController::class, 'updateContact']);
Route::delete('/vendors/{id}/contacts/{contact}',  [VendorController::class, 'destroyContact']);
Route::post  ('/vendors/{id}/bank-accounts',           [VendorController::class, 'storeBankAccount']);
Route::put   ('/vendors/{id}/bank-accounts/{bank}',    [VendorController::class, 'updateBankAccount']);
Route::delete('/vendors/{id}/bank-accounts/{bank}',    [VendorController::class, 'destroyBankAccount']);
Route::post  ('/vendors/{id}/gst-scrutiny',            [VendorController::class, 'storeGstScrutiny']);
Route::put   ('/vendors/{id}/gst-scrutiny/{gst}',      [VendorController::class, 'updateGstScrutiny']);
Route::delete('/vendors/{id}/gst-scrutiny/{gst}',      [VendorController::class, 'destroyGstScrutiny']);
Route::post  ('/vendors/{id}/step/kyc',            [VendorController::class, 'storeKyc']);
Route::post  ('/vendors/{id}/step/products',       [VendorController::class, 'storeProducts']);
Route::get   ('/vendors/{id}/service-mappings',        [VendorController::class, 'serviceMappings']);
Route::post  ('/vendors/{id}/step/services',           [VendorController::class, 'storeServices']);
Route::patch ('/vendors/{id}/service-mappings/{map}',  [VendorController::class, 'updateServiceMapping']);
Route::delete('/vendors/{id}/service-mappings/{map}',  [VendorController::class, 'destroyServiceMapping']);
Route::delete('/vendors/{id}',                     [VendorController::class, 'destroy']);   // no screen calls it

// Segment documents and the Evidence Vault (SegmentDocUploadController) — {type} = supplier
Route::get   ('/segment-uploads/download',                 [SegmentDocUploadController::class, 'download']);
Route::get   ('/segment-uploads/{type}/{id}/summary',      [SegmentDocUploadController::class, 'summary']);
Route::get   ('/segment-uploads/{type}/{id}/vault',        [SegmentDocUploadController::class, 'vault']);
Route::get   ('/segment-uploads/{type}/{id}',              [SegmentDocUploadController::class, 'index']);
Route::post  ('/segment-uploads/{type}/{id}',              [SegmentDocUploadController::class, 'store']);
Route::delete('/segment-uploads/{type}/{id}/{uploadId}',   [SegmentDocUploadController::class, 'destroy']);

// Convert to Supplier (P2p\SourcingController)
Route::get   ('/p2p/new-suppliers/{supplier}/convert',     [SourcingController::class, 'convertPrefill']);
Route::post  ('/p2p/new-suppliers/{supplier}/convert',     [SourcingController::class, 'convertSupplier']);
```

`{id}`, `{contact}`, `{bank}`, `{gst}`, `{map}`, `{uploadId}`, `{supplier}` are
numeric (`whereNumber`). The multipart `PUT` routes are sent as `POST` +
`_method=PUT`.

Other APIs the screens call: `/clm/segment-rules`, `/clm/segment-rules/for-segment/{id}`,
`/clm/trade-doc-library/for-party/supplier`, `/clm/segments`, `/clm/signature-requests`,
`/products`, `/p2p/services`, `/p2p/services/master-bundle`, `/p2p/orders/{po}/documents/…`.

### 3.2 Frontend Route and Menu

| Item | Value |
|---|---|
| URL | `/suppliers` (`/vendors` redirects to it) |
| Registered in | `App.tsx` → `lazyPage(Vendors)` |
| Route check | `utils/routeAccess.ts canAccessPath()` returns `isBiz` (user type `branch_user` or `employee`); `p2p.supplier` is **not** checked |
| Page check | `Vendors()` checks again, else the card *"Branch / Employee only"* |
| Menu | `IdimsHeader`: **P2P → P2P Master Management → Supplier Management** when `perms['p2p.supplier'].can_view` and the plan has not expired. Super admin and client admin get fixed menus without P2P |

### 3.3 Who Can Do What (server checks)

| Check | Rule | Used by | Refusal |
|---|---|---|---|
| `Vendor::scopeForUser` (read scope) | employee / branch user: `client_id IS NULL OR (own client AND (branch_id IS NULL OR own branch))`; client admin / user: own client (or NULL); super admin: all | list, show, every supplier write (`forUser()->findOrFail()`) | 404 *No query results for model [App\Models\Vendor] {id}* |
| `MasterVisibility::hierarchicalDenial()` | called on every supplier write, **always returns null for a Vendor** | supplier writes | never refuses |
| `SSM::serviceEditDenial()` | per **service** — an employee of the service's client and branch, else `hierarchicalDenial` on the Service | `step/services`, PATCH / DELETE service mapping | 403 *"{CODE}: You cannot edit this record — …"* |
| `SDUC::resolveOwner()` | `{type}` known, supplier exists, same `client_id` (no branch check) | segment uploads, vault | 404 |
| Convert endpoints | New Supplier in your client | `convertPrefill()`, `convertSupplier()` | 404 |
| none | — | `VC::index()` has no permission check | — |

---

## 4. COMMON CONVENTIONS

### 4.1 Request and Response Shapes

| Case | Shape |
|---|---|
| Success | `{ "data": <shape()> }` (most VC endpoints); the list is Laravel's paginator plus `facets` |
| Validation | 422 `{ "message": "…", "errors": { field: [msg] } }`; VC relabels field names through `FIELD_LABELS` (e.g. `vendor_type_id` → "supplier type") only where noted |
| Business refusal | 422 `{ "message": "…" }` (sometimes with `errors`), 409 for the segment-document confirmation |
| Not in scope | 404 *No query results for model [App\Models\Vendor] {id}* |
| Auth | 401 *Unauthenticated.* / 401 *Account is no longer active. Please sign in again.* |

### 4.2 How the Page Is Wired

```
/suppliers  →  App.tsx lazyPage(Vendors)
  └─ Vendors()
       ├─ state: scopeTab='domestic', kindTab='all', page, rpp (from localStorage)
       ├─ refresh()               GET /vendors?scope=domestic&per_page=rpp
       ├─ background fetchAll()   type-tab counts (≤ 1000 rows)
       ├─ idle preload            master bundle → vendorBundleCache (sessionStorage)
       └─ popups: SupplierScopeGate → AddVendorModal (add / edit),
                  MappedProductsViewPopup, MappedServicesViewPopup,
                  SupplierEvidenceVaultModal, Contact Persons, Segments
```

### 4.3 Save Styles

| Style | Where |
|---|---|
| **Step save** | `step/identity`, `step/contacts`, `step/kyc` — the step buttons |
| **Immediate child save** | contacts, banks, GST scrutiny, segment uploads — each popup saves on its own |
| **Replace-all** | `step/products`, `step/services`, `step/kyc` — always send every row |

## 5. FEATURE 1 — OPEN THE SUPPLIER LIST

### 5.1 Overview

The list shows the suppliers the user can see, split by origin (Domestic /
International) and by type (All / Material / FFD / Services), with search, a
Filter popup, a pager and a table that fills the screen.

### 5.2 Files Involved

| Layer | File · Function |
|---|---|
| Page | `Vendors.tsx` → `Vendors()`, `refresh()`, `switchScope()`, `typeKind()`, `countKinds()`, `fetchAll()`, `recompute()`, `RefineSuppliers`, `apiToVendor()` |
| Helpers | `vendorBundleCache.ts`, `serviceMapping.ts` → `serviceBucketOf()` |
| API | `GET /vendors`, `GET /vendors/master-bundle` (preload), `GET /p2p/services?per_page=200` (service counts) |
| Backend | `VC::index()`, `SupplierCompliance::statuses()` |

### 5.3 Key Code

```ts
// Vendors.tsx
const KIND_FETCH_CAP = 1000;
const matchesKind = (v: Vendor, k: SupplierKind) =>
  k === 'all' || (!!v.type && v.type !== 'Pending' && typeKind(v.type) === k);
```

**Processing Explanation:**
1. A type tab (Material / FFD / Services) is filtered **in the browser**, over at most 1000 rows fetched with the same filters.
2. Untyped suppliers (`Pending`) never appear under a type tab, only under All.

### 5.4 Access

* Frontend: `routeAccess.ts canAccessPath()` returns `isBiz` (user type
  `branch_user` or `employee`) for `/suppliers`, `/vendors` and `/vendors/…`;
  `p2p.supplier` is **not** checked. `Vendors()` checks again and otherwise shows
  the card *"Branch / Employee only — The Suppliers module is available only to
  branch users and employees."* `/vendors` redirects to `/suppliers`.
* Menu: `IdimsHeader` shows **P2P → P2P Master Management → Supplier
  Management** when `perms['p2p.supplier'].can_view` is true and the plan has
  not expired. Super admin and client admin get fixed menus without P2P.
* Server: `VC::index()` has no permission check. Rows are limited by
  `Vendor::scopeForUser` (employee and branch user:
  `MasterVisibility::applyBranchScope` — `client_id IS NULL OR (client_id = own
  AND (branch_id IS NULL OR branch_id = own branch))`; client admin / client
  user: `client_id IS NULL OR own client`, narrowed by a valid `branch_id`; super
  admin: all).

### 5.5 Step-by-Step Flow

1. The page mounts with `scopeTab='domestic'`, `kindTab='all'`, page 1 and the
   page size from `localStorage` `cbc.p2p.suppliers.perPage.v2` (used only if
   10–200, else 10). At ≤ 820 px `recompute()` returns early, so there is no
   auto-fit and that stored size (or 10) stays.
2. Shimmer rows, then the table. Badges: Domestic / International from
   `facets.scope`; the four type tabs from `countKinds()` (below).
3. The user can switch origin (`switchScope()` clears the type counts and total
   in the click), switch type tab, type in the search (500 ms debounce, × to
   clear), open **Filter**, page, or pick 10 / 25 / 50.
4. When the browser is idle and the master bundle is not in `sessionStorage`,
   `GET /vendors/master-bundle` is preloaded (`requestIdleCallback` or 500 ms);
   hovering / focusing **Add Supplier** preloads the wizard chunk
   (`warmVendorWizard`).

### 5.6 Validations

* Browser: none — the search text is trimmed and sent after 500 ms; any search,
  filter or tab change returns to page 1.
* Server: `VC::index()` calls no `validate()`. `per_page` is only `(int)`-cast
  (default 24, **no cap**); `status` is an exact match; `%` and `_` in `q` are
  not escaped.

### 5.7 API Requests

```
GET /api/vendors?scope=domestic&tab=all&page=1&per_page=12&q=acme&categories=star,general&compliance=non_compliant
```

`q`, `categories`, `compliance` are left out when empty; `tab` is always `all`.
Three more calls use the same filters:

| Call | When | Params |
|---|---|---|
| `fetchAll()` | A type tab is open, or (background) the filter key changed | `page=1&per_page=1000` (`KIND_FETCH_CAP`) |
| `countSuppliersFor(draft)` | Filter popup, 250 ms after each change | `page=1&per_page=1` — no type tab |
| `loadServiceCounts()` | Once a service-type row is on screen, and after a Mapped Services change | `GET /p2p/services?per_page=200` |

### 5.8 Backend Processing — `VC::index()`

1. `light=1` → picker shape and return (not used by this page).
2. `Vendor::forUser($user, branch_id)`.
3. Eager loads: `primaryAddress` (+ `state`, `country`), `addresses`,
   `vendorType`, `segment`, `segments`, `riskLevel`, `complianceBehaviour`;
   `withCount('productMappings')`; `0 as opportunity_count`; `orderByDesc('id')`.
4. `q`: `ILIKE` on company / legal name, code, primary email, GSTIN, category
   (lower-cased, spaces → `_`), any address's contact name / phone / email /
   city / state code, the primary state and country names, the type name and the
   segment names.
5. `status` (exact).
6. Scope counts (on a clone) for both origins.
7. `scope`: **domestic** = primary country `LOWER(name)='india'`, or no primary
   address, or no country; **international** = any other country.
8. `tab=recurring` → `whereRaw('1 = 0')`.
9. Facets: `grand_total`, `category{…}` grouped by `supplier_category`, and
   `SupplierCompliance::statuses(<every scoped id>, clientId)` (Section 17).
10. `categories` → `whereIn('supplier_category', …)`; `compliance` →
    `whereIn('vendors.id', <ids with that status> ?: [0])`.
11. `paginate(per_page)`; each row gets `compliance_status` (default
    `Compliant`).

### 5.9 Database

read: `vendors`, `vendor_addresses`, `master_states`,
`master_countries`, `master_vendor_types`, `vendor_segments` + `clm_segments`,
`master_risk_levels`, `master_compliance_behaviours`, `vendor_product_mappings`
(count), and the compliance tables (Section 17). Written: nothing.

### 5.10 Response and UI

```json
{ "current_page": 1, "per_page": 12, "total": 27, "last_page": 3,
  "data": [ { "id": 31, "vendor_code": "S-031", "company_name": "ABC Logistics",
              "supplier_category": "general", "status": "inactive", "created_at": "…",
              "compliance_status": "Non Compliant", "product_mappings_count": 4,
              "opportunity_count": 0,
              "vendor_type": { "id": 1, "name": "Material/ Goods", "kind": null,
                               "service_type": null, "classification": null },
              "segment": { "id": 2, "name": "Chemicals", "regulatory_status": "High" },
              "segments": [ { "id": 2, "name": "Chemicals", "regulatory_status": "High" } ],
              "primary_address": { "city": "Pune", "state_code": "27", "contact_name": "Priya",
                                   "email": "priya@abc.in", "contact_no": "9876543210",
                                   "designation": "Manager",
                                   "state": { "id": 14, "name": "Maharashtra" },
                                   "country": { "id": 1, "name": "India" } },
              "addresses": [ … ], "risk_level": { "id": 1, "name": "Low" },
              "compliance_behaviour": null } ],
  "facets": { "grand_total": 27, "scope": { "domestic": 25, "international": 2 },
              "category": { "star": 0, "general": 27, "high_risk": 0, "blacklisted": 0 },
              "compliance": { "compliant": 20, "non_compliant": 7 } } }
```

* `apiToVendor()` maps each row: code (`vendor_code`, else `S-` + padded id),
  created date `dd/mm/yyyy`, type name (else `Pending`), state (name, else state
  code, else `—`), contacts (addresses with a name, primary first, role
  *Primary* / designation / *Contact*), segments, category, compliance, product
  count.
* **Type tabs.** `typeKind(name)`: contains `logist|transport|ffd|freight` →
  FFD; `service` → services; else material. `matchesKind()` keeps untyped
  (`Pending`) suppliers out of every type tab. With a type tab open, `refresh()`
  uses `fetchAll()` (≤ 1000 rows), filters, and pages in the browser (cached in
  `kindCacheRef` by filter key). Counts: `countKinds()` over the same rows, or a
  background `fetchAll()` on the All tab. The All badge is `kindCounts.all ??
  total`.
* **Columns** (header text): Sr. No · Supplier Code · Supplier · Supplier Type ·
  Segment · Location · Contact Person · Supplier Category · Compliant Status ·
  Mapped Products / Services · Action. Location line 2 shows *GST {stateCode}*
  except on the International tab. An empty category shows "—" (tooltip *"No
  category set on this supplier yet"*). Compliant Status is green unless the text
  starts with "non"; it is never "—" (the server always stamps a value).
* **Count column.** `serviceBucketOf(type) !== null` (the eight service type
  names) → the service count from `loadServiceCounts()` (each service's
  `supplier_names`, matched on the lower-cased company name) → **Mapped
  Services**; every other type (FFD and untyped too) → `product_mappings_count`
  → **Mapped Products**. Tooltips *"View mapped services"* / *"View mapped
  products"*; 0 is not clickable (*"No services mapped to this supplier yet"* /
  *"No products mapped to this supplier yet"*).
* **Filter Suppliers** (`RefineSuppliers`): Section 5.11; options with count 0 are
  disabled (*"No supplier has this yet"*) unless already ticked; Apply is
  disabled until the draft differs (*"Select a category or compliance status to
  filter by"*); *"Applying…"* waits for the list (15 s safety).
* **Screen fill** (`recompute()`), **scroll listener**: Section 5.11.
* Errors: *"Load failed — Could not load suppliers"*. Empty: *"No suppliers
  found"*.


### 5.11 Code Walkthrough (function by function)

```
/suppliers  →  App.tsx lazyPage(Vendors)
  │
  ├─ routeAccess.ts: branch_user | employee only
  │
  └─ Vendors()
       ├─ access check again (else the "Branch / Employee only" card)
       ├─ state: scopeTab='domestic', kindTab='all', page, rpp (from localStorage)
       ├─ refresh()                          GET /vendors?scope=domestic&per_page=rpp
       ├─ background: fetchAll() → countKinds()   (type-tab counts, ≤ 1000 rows)
       ├─ idle: master bundle preload        → vendorBundleCache (sessionStorage)
       ├─ useEffect recompute()              table height = the screen  (Section 5)
       └─ useEffect scroll listener          hover pause while scrolling (Section 5)
```

`?edit=<id>&return=<path>` skips the list click: the params are stripped from
the URL first, then it checks `GET /vendors/{id}` and opens the wizard in edit
mode straight away. On a **404** (another branch, or deleted) it toasts
*"Supplier not available — This supplier isn’t available to edit from here — it
may belong to another branch or has been removed from the Supplier master."*
(any other error: the same title with the server message, or *"Could not open
this supplier for editing."*) and navigates to `return` only if one was given
(`return` is used only if it starts with `/`). A non-numeric id, or one ≤ 0, is
ignored silently.

**Add Supplier** → `setScopeGateOpen(true)` → `SupplierScopeGate` (lazy) →
`onChoose(scope)` sets `addScope`, closes the gate and opens `AddVendorModal`
with `scope={addScope}` and no `vendorId`. Closing the wizard clears
`editingId`, `addScope` and `returnToRef` and runs `refresh({ silent: true })`.

There is no delete flow: `VendorController::destroy()` exists but no screen
calls `DELETE /vendors/{id}`.

#### `refresh({ silent, keepKindCounts })`

```
reqRef.current++                        ← this call's token
GET /vendors { q, categories, compliance, scope, tab, page, per_page }
  │
  ├─ stale token? → drop the response   ← a slow old request can't overwrite
  ├─ kindTab !== 'all' → fetch up to KIND_FETCH_CAP (1000),
  │        filter with typeKind(), page in the browser, cache by filter key
  ├─ map rows → Vendor objects (contacts, segments, location, compliance)
  └─ facets → tab and filter counts
```

* `silent` keeps the table on screen (no shimmer) — used after closing the vault,
  after the wizard closes or saves, and after a Mapped Products change (those
  last ones without `keepKindCounts`, so they also redo the 1000-row recount).
* `keepKindCounts` skips the 1000-row recount — the vault can't change a type.
* The type-tab counts always come from `countKinds()` in the browser. The code
  would use `facets.kind` if the API sent it, but `VendorController::index()`
  never does.

#### `switchScope(next)`

Clears `kindCounts` and the total **in the click**, before the request — so the
Domestic counts never appear under International while it loads.

#### `typeKind(name)`

```ts
logist | transport | ffd | freight  → 'logistics'
service                              → 'services'
anything else                        → 'material'
```

#### `recompute()` — the table fills the screen

```ts
if (innerWidth <= 820) { clear the heights; return; }   // phones scroll normally
top     = scroller.getBoundingClientRect().top
footerReserve = footer.footer height + 8  (15 if there is no footer)
cardH   = max(240, innerHeight - top - footerReserve - 2)
fit     = max(10, floor((cardH - thead - PAGER(56) - scrollbar) / rowHeight))
if (autoFit) { setRpp(fit); keep the first visible row; save to localStorage }
scroller.style.minHeight = height = maxHeight = `${cardH - PAGER}px`
```

When it runs (all set up in one `useEffect`, and all cleaned up on re-run):

```ts
recompute();                                   // mount
requestAnimationFrame(recompute);              // next frame
setTimeout(recompute, 340);                    // after the "What We Are Doing Here" strip
                                               //   finishes its .3s collapse
window resize → setTimeout(recompute, 140)     // debounced
new ResizeObserver(() => recompute())          // NOT debounced: runs before paint
   observes every previous sibling of the scroller and of each ancestor up to
   <body>, with { box: 'border-box' } — i.e. every block ABOVE the table
document.fonts?.ready.then(recompute)          // web fonts loaded
```

Why each one: the fixed height is measured from where the table **starts**.
The strip's collapse animation, the top menu folding items into "More", the
banner, the toolbar and late fonts all move that start without a window resize,
and a height measured before the move left an empty band under the card (or
pushed it past the footer). The ResizeObserver callback runs after layout but
before paint, so the corrected height is the first one the user sees; only
blocks above the table are observed, so the table's own new height can't loop
back into it. The 340 ms timer is kept alongside it for the strip.

The effect's dependencies are `tab, search, loading, swapping, brefOpen, rpp`
and "has rows". `max-height` is what stops the flex item growing to its rows;
the `-2` absorbs border rounding that otherwise left 2 px of page scroll.

#### The scroll listener

```ts
window.addEventListener('scroll', onScroll, { capture: true, passive: true });
onScroll: add 'is-scrolling' to .sup-table-wrap; remove it 150 ms after the last scroll
```

CSS: `.sup-table-wrap.is-scrolling > .table-responsive { pointer-events: none }`.
A class on one element, no `setState` — scrolling never re-renders React.

#### The count column

* Product suppliers: `product_mappings_count` → opens `MappedProductsViewPopup`.
* Service suppliers (`serviceBucketOf(type) !== null`): counts from
  `GET /p2p/services?per_page=200` → `supplier_names` per lower-cased company
  name; fetched only when such a row is on screen → opens `MappedServicesViewPopup`
  (a thin wrapper over `MappedServicesPopup` with `addInHeader`, `code`, `name`).

#### Filter — `RefineSuppliers`

Keeps a **draft** selection. Each change calls `countSuppliersFor(draft)`
(`GET /vendors?per_page=1`, same search / scope / tab) for the live *"N of M
match"* — debounced **250 ms**, a newer request wins, and **skipped** while the
draft equals the applied filters (then the list's own total is shown). Only
**Apply** copies the draft into `catSel` / `compSel` and triggers `refresh()`;
the Apply button shows *"Applying…"* and awaits a promise parked in
`applyWaitRef`, which `refresh()` resolves when the request carrying that token
finishes (with a 15 s safety timeout).

### 5.12 Edge Cases and Known Gaps

* Type tabs and their counts stop at 1000 suppliers; the live filter count
  ignores the type tab, so inside a type tab "N of M" mixes two bases.
* `typeKind()` (any name containing "service") and `serviceBucketOf()` (eight
  exact names) disagree for a tenant-made type such as "Service Provider": it
  sits in the Services tab but shows a **product** count.
* Service counts read only the newest 200 services and match on the company
  name — two suppliers with the same name share a count.
* The compliance sweep runs on **every** `GET /vendors` (list, background
  1000-row fetch, each Filter change).
* If the total shrinks, the request still asks for the old page — an empty page
  can show.

---

## 6. FEATURE 2 — ADD SUPPLIER: THE DOMESTIC / INTERNATIONAL CHOOSER

### 6.1 Overview

**Add Supplier** first asks for the supplier's origin. The choice decides the
country list, the tax field (GSTIN or TIN), the bank format and which document
rules apply. Nothing is sent to the server until Stage 1 is saved.

### 6.2 Files Involved

| Layer | File · Function |
|---|---|
| Page | `Vendors.tsx` → `setScopeGateOpen()`, `onChoose()` → `setAddScope()` |
| Popup | `SupplierScopeGate.tsx` (lazy) |
| Wizard | `AddVendorModal.tsx` → `effectiveScope`, `supplierDocType`, `countryScopeLocked` |
| API | none |

### 6.3 Access

anyone on the page. Nothing is sent to the server until
Stage 1 is saved.

### 6.4 Step-by-Step Flow

1. **Add Supplier** → `setScopeGateOpen(true)` → `SupplierScopeGate` (lazy).
2. Title *"Add Supplier"*, subtitle *"Choose the supplier’s origin to
   continue"*. Cards: **Domestic Supplier** — *Supplier registered and operating
   within India* (chips GST · PAN · Instant); **International Supplier** —
   *Supplier registered and operating outside India* (chips Export Docs ·
   Customs · Forex).
3. A click selects a card; a double-click commits. **Continue** is disabled
   until a card is selected. Esc, ×, **Cancel** or a backdrop click closes it.
4. `onChoose(scope)` → `setAddScope(scope)` and `AddVendorModal` opens with
   `scope` and no `vendorId`.

### 6.5 Validations

none besides "a card is selected".

### 6.6 What the scope changes in the wizard

(`effectiveScope`, `supplierDocType`):

| | Domestic | International |
|---|---|---|
| Country | Auto-set to India (the effect in `AddVendorModal` picks the India option and clears State / State Code), list holds India only, field locked (`countryScopeLocked`; click → *"Country is fixed — You chose Domestic, so this supplier is registered in India. Close and add them as an International supplier to pick another country."*) | India removed from the list; placeholder *"Select Country (outside India)"* |
| Tax field | **GST Number** (15 characters, upper-cased while typing) | **Tax Identification Number (TIN)** |
| State Code | Shown, read-only, required | Hidden (City takes its place) |
| GST Applicable | `Yes` (derived from the country) | `No` |
| Segment rules | `document_type=domestic` | `document_type=international` |
| Contact No | `+91` prefix, 10 digits starting 6–9 | 7–15 digits |
| Bank | Account 9–18 digits, **IFSC Code** | Account 8–34 letters / digits, **SWIFT / BIC** |
| GST Scrutiny tab | Shown | Hidden |

Once a country is picked, the **country** decides all of this, not the chooser
(`supplierDocType` = *India* → domestic, anything else → international; with no
country yet it follows `scope`).

### 6.7 Edge Cases and Known Gaps

`handleSave` and a row's Edit click do not clear
`addScope`, so an Edit right after an Add passes the last chosen scope; it is
only used when the supplier has no country.

---

## 7. FEATURE 3 — STAGE 1: SUPPLIER IDENTIFICATION & ADDRESS DETAILS

### 7.1 Overview

The first wizard tab captures the company identity, Supplier Type, segments,
risk, behaviour, category, registered address and GSTIN / TIN. The first save
**creates** the supplier (`draft`, code `S-NNN`).

### 7.2 Files Involved

| Layer | File · Function |
|---|---|
| Wizard | `AddVendorModal.tsx` → mount effects, `hydrate()`, `goNext()`, `saveIdentity()`, `flagErrors()`, `supplierBehaviourOptions`, `openSegmentAdd()` |
| Helpers | `fieldValidators.ts`, `useRuledSegments.ts`, `vendorBundleCache.ts` |
| API | `GET /vendors/master-bundle`, `GET /clm/segment-rules`, `GET /clm/segments?lite=1` (Segment "+"), `POST /vendors/step/identity` |
| Backend | `VC::storeIdentity()`, `normalizeSegmentIds()`, `assertGstUniqueForClient()`, `nextVendorCode()`, `SegmentGuard` |

### 7.3 Key Code

**Supplier Behaviour options (browser)**

```ts
// AddVendorModal.tsx
const supplierBehaviourOptions = useMemo(() => {
  const base = behaviourOpts.length ? behaviourOpts : SUPPLIER_BEHAVIOUR_OPTS;
  return vendorBehaviour && !base.some(o => o.value.toLowerCase() === vendorBehaviour.toLowerCase())
    ? [...base, { value: vendorBehaviour, label: vendorBehaviour }]
    : base;
}, [behaviourOpts, vendorBehaviour]);
```

**Supplier Behaviour resolution (server)**

```php
// VendorController::storeIdentity()
$vb = \App\Models\Masters\VendorBehaviour::firstOrCreate(
    ['client_id' => $user->client_id, 'name' => trim($data['vendor_behaviour'])],
    ['branch_id' => $user->branch_id, 'status' => 'Active', 'created_by' => $user->id],
);
$data['vendor_behaviour_id'] = $vb->id;
```

**Processing Explanation:**
1. The options are the **Supplier Behaviour master's** active rows (from the master bundle); the fixed four are used only when the master has none.
2. A saved behaviour that is no longer active is appended, so editing never blanks it.
3. The browser sends the **name**; the server finds (or creates) the tenant's master row by that exact name and stores its id.

### 7.4 Access

anyone who opened the wizard. Server: `VC::storeIdentity()`
— no permission check; on edit `Vendor::forUser()->findOrFail()` (404) and
`hierarchicalDenial` (never denies a supplier).

### 7.5 Step-by-Step Flow

1. Fill **Basic Company Details** and **Supplier Address Details**.
2. **Save & Next →** (edit: **Update & Next →**) → `goNext()` →
   `saveIdentity()`. Clicking the **Contact Person Details** tab does the same.
3. Success → *"Identity saved — Supplier identity details captured"*, the
   supplier code appears in the header, and the **Contact Person Details** tab
   opens.

### 7.6 Fields and where their options come from

| Field | Options / source | Sent as |
|---|---|---|
| Company Name, Company Legal Name | Typed; `handleCompanyNameChange()` | `company_name`, `legal_name` |
| Supplier Type | Fixed tree `SUPPLIER_TYPE_TREE` (Material/ Goods · FFD/ Transporter · Soft Service Provider · *Self Consumable Service Provider*: Trackable Services, Consumable Services · *Other Operational Service Provider*: Professional / Utility / Facility / Maintenance / Outsourcing Services). Group headings can't be picked. The **id** is looked up in the bundle's `vendor_types` by name (`supplierTypeId()`, exact name first, then ignoring spaces / case) | `vendor_type_id` + `vendor_type: null`; only when no bundle row matches, `vendor_type: "<name>"` |
| Company Website | Typed | `website` |
| Supplier Segment | Bundle `segments` (id, code, name, `regulatory_status`), sorted: picked → allowed → ruled for the other origin → no rule. Badges: regulatory status, plus **DOM** / **INT** / **+2** from `useRuledSegments()` (`GET /clm/segment-rules` → `typesById`) | `segment_ids` (all), `segment_id` (first) |
| Risk Level | Bundle `risk_levels` (active, id) | `risk_level_id` |
| Supplier Behaviour | **Supplier Behaviour master** — see the note below | `vendor_behaviour` (the **name**) |
| Supplier Category | Fixed `SUPPLIER_CATEGORY_OPTS`: Star Supplier · General · High Risk · Blacklisted | `supplier_category` (default `general`) |
| Registered Office Address | Typed; `sanitizeKycAddress` (max 200) | `address.address_line` |
| Country | Bundle `countries`, filtered by the scope | `address.country_id` |
| State | Bundle `states` of that country, A–Z | `address.state_id` |
| State Code | Bundle `state_codes` row of the State (`state_code`), read-only | `address.state_code` |
| GST Number / TIN | Typed | `gst_number` |
| City | Typed; `sanitizeKycAlpha(raw, 60)` | `address.city` |
| Google Location Link | Typed | `address.google_location` |
| (Pincode) | No field on screen; sent if a value was loaded | `address.pincode` |
| (GST Applicable) | No field; set from the country | `gst_applicable` |

> **Supplier Behaviour comes from its master** (commit `cdc5aff67`). `hydrate()` fills `behaviourOpts` from the
> bundle's `vendor_behaviour` (active rows of `master_vendor_behaviour` in the
> user's read scope, ordered by id): names are trimmed and de-duplicated
> case-insensitively (the first one wins), and the option **value is the name**.
> `supplierBehaviourOptions` falls back to the fixed four
> (`SUPPLIER_BEHAVIOUR_OPTS`: Genuine · Cooperative & Responsive · Non Responsive
> & Inconsistent · Fraud Alert) **only when the bundle has no active row in the
> user's read scope** (`behaviourOpts` empty), and
> appends the supplier's saved behaviour if it is not in the list (e.g. it was
> made inactive), so editing never blanks it. The review panel prints the
> saved name as-is. The quick-add handler (`MasterRecordModal` →
> `case 'vendor_behaviour'`) adds the new behaviour **by name** and selects
> it — but the Supplier Behaviour `Field` passes no `addNew`, and `setQuickAdd`
> is only ever called with `null`, so no "+" is shown and that handler cannot
> run today. Server side: `storeIdentity()` resolves the name
> with `VendorBehaviour::firstOrCreate(['client_id' => user's client, 'name' =>
> trim(name)], ['branch_id', 'status' => 'Active', 'created_by'])`.

### 7.7 Validations — while typing (sanitisers; the message shows under the field)

| Field | Rule | Message |
|---|---|---|
| Company / Legal Name | `<` `>` removed; SQL-like text (`OR 1=1`, `--`, `; DROP…`, `UNION SELECT`, `javascript:`, `onX=`) removed; anything but letters (any script), digits, spaces and `- . , ( ) & / ' %` removed; max 100 | *HTML characters (< or >) are not allowed* · *SQL-like patterns are not allowed* · *Use letters, numbers, spaces, and . , - ( ) & / ' % only* |
| Registered Office | Same XSS / SQL strip; allowed `A–Z a–z 0–9 space - . , ( ) & / ' # %`; max 200 | the first two above · *Use letters, numbers, spaces, and . , - ( ) & / ' # % only* |
| City | Letters, spaces, `. , ' -`; max 60 | *Only alphabetic characters are allowed* |
| GST Number | Upper-cased, only `A–Z 0–9`, max 15 | — |
| TIN | `sanitizeTin()`: only letters, digits, `- / .` and space, upper-cased, max 30 | — |

### 7.8 Validations — on Save (`saveIdentity()`, all at once, then `flagErrors()`)

| Field | Rule | Message |
|---|---|---|
| Company Name | required | *Company Name is required* |
| Company Legal Name | required | *Company Legal Name is required* |
| Supplier Type | required | *Supplier Type is required* |
| Risk Level | required | *Risk Level is required* |
| Supplier Behaviour | required | *Supplier Behaviour is required* |
| Supplier Segment | at least one | *Select at least one supplier segment* |
| Supplier Segment | no segment has rules **only for the other origin** — the test is `t && t.size > 0 && !t.has(supplierDocType)`, so a segment with **no rule at all** (`t` undefined) is not flagged and saves if it is already selected (saved supplier, Convert prefill); it is only greyed out in the dropdown (`disabledSegmentIds`). Runs only once the rules loaded and a country is set | *{names} has / have no Domestic / International rule — this is a Domestic / International supplier, so the segment's document type must match.* |
| Company Website | `validateWebsite()` | *Website cannot contain spaces* · *Website is too long (max 500 characters)* · *Website must start with http:// or https://* (ftp / file / javascript / mailto) · *Enter a valid website (e.g. www.example.com)* |
| TIN (international) | required; `validateTin()` | *Tax Identification Number (TIN) is required* · *… may contain only letters, digits, hyphen, slash, period and spaces.* · *… must be at least 3 characters* · *… must be 30 characters or fewer* |
| GST Number (GST Applicable = Yes) | required; `validateGstin()` (`^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$`); starts with the State Code padded to 2 digits | *GST Number is required* · *GST Number must be a valid 15-character GSTIN — e.g. 29ABCDE1234F1Z5* · *GST Number must start with the state code NN.* |
| Registered Office Address | required | *Registered Office Address is required* |
| Country | required | *Country is required* |
| Google Location | if filled, `^https?://\S+$` | *Enter a full link starting with https://* |
| State | required | *State is required* |
| State Code (domestic) | required, `^\d{1,2}$` | *State Code is required* · *State Code must be a 1–2 digit GST code* |
| City | required | *City is required* |

The toast: all messages end in "is required" → *"Missing required fields —
Please check: Company Name, Risk Level, …"*; otherwise *"Invalid value"* (one
field) or *"Please fix these fields"* with *"Label: message · …"*. The page
scrolls to the first marked field.

Also while editing the segments (the `MasterMultiSelect` `onChange`):

* Adding a segment that has rules only for the other origin is undone (same
  `t && t.size > 0 && !t.has(…)` test — a segment with no rule at all can't be
  added only because it is disabled in the dropdown): *"Segment not allowed
  — {names} has no Domestic / International rule — this is a … supplier. Add the
  … rule in the Document Control Panel first."*
* A segment with no rule at all is greyed out with the hint *"not available for a
  Domestic / International supplier — no matching rule in the Document Control
  Panel"* (no country yet: *"no document rule defined in the Document Control
  Panel yet"*).
* Removing a segment is undone when it is locked or has uploads — Section 13.
* **Segment "+"** → `openSegmentAdd()` → `GET /clm/segments?lite=1` → the CLM
  `SegmentModal` → `POST /clm/segments` → the new segment is added to the list
  (not selected), `bustVendorMasterBundle()`, toast *"Segment created — {name}
  can't be selected until a rule is defined for it in the Document Control
  Panel."*; failure *"Save failed — <message>"* or *"Could not save segment"*.

### 7.9 Validations — server (`VC::storeIdentity()`)

```
id                       nullable|integer|exists:vendors,id
company_name, legal_name required|string|max:255
website                  nullable|string|max:500
gst_applicable           nullable|string|in:Yes,No
gst_number               nullable|string|max:30
vendor_type_id           nullable|integer|exists:master_vendor_types,id
vendor_type              nullable|string|max:255
risk_level_id            nullable|integer|exists:master_risk_levels,id
vendor_behaviour_id      nullable|integer|exists:master_vendor_behaviour,id
vendor_behaviour         nullable|string|max:255
segment_id               nullable|integer|exists:clm_segments,id
segment_ids              nullable
classification_id        nullable|integer|exists:master_customer_classifications,id
compliance_behaviour_id  nullable|integer|exists:master_compliance_behaviours,id
supplier_category        nullable|string|in:star,general,high_risk,blacklisted
address                  nullable|array
address.address_line    nullable|string|max:1000
address.country_id      nullable|integer|exists:master_countries,id
address.state_id        nullable|integer|exists:master_states,id
address.state_code      nullable|string|max:32
address.city            nullable|string|max:128
address.pincode         nullable|string|max:16
address.google_location nullable|string|max:1000|regex:/^https?:\/\/[^\s]+$/i
```

Default Laravel messages, field names relabelled by `FIELD_LABELS`. Then, in
order (all 422 unless stated):

| Check | Message (`errors` key) |
|---|---|
| Type change on a supplier with a committed PO / SPI | *This supplier is already on a Purchase Order \| a Supplier Invoice, so its Supplier Type can no longer be changed.* (`vendor_type`) |
| International, TIN empty | *Tax Identification Number (TIN) is required for an international supplier.* (`gst_number`: *Tax Identification Number (TIN) is required.*) |
| International, TIN not `^[A-Za-z0-9-/. ]{3,30}$` | *Tax Identification Number (TIN) is invalid.* (`gst_number`: *TIN must be 3–30 characters: letters, digits, hyphen, slash, period and spaces only.*) |
| India and `gst_applicable` ≠ Yes | *GST is mandatory for an Indian supplier — set GST Applicable to Yes.* (`gst_applicable`) |
| GSTIN starts with the State Code | *GST Number must start with the state code NN.* — **never fires** (reads `$data['address']` after it was unset) |
| GSTIN used by another supplier of the client (`assertGstUniqueForClient`, only when `gst_applicable=Yes`) | *GST number X is already registered to another supplier.* (`gst_number`: *This GST number is already registered to another supplier.*) |
| Segment removal guards (edit) | Section 13 |

### 7.10 API Request

```json
POST /api/vendors/step/identity
{ "id": null,
  "company_name": "ABC Logistics", "legal_name": "ABC Logistics Pvt Ltd",
  "website": "www.abclogistics.com",
  "gst_applicable": "Yes", "gst_number": "27ABCDE1234F1Z5",
  "vendor_type_id": 1, "vendor_type": null,
  "risk_level_id": 2, "vendor_behaviour": "Genuine",
  "segment_id": 4, "segment_ids": [4, 7], "supplier_category": "general",
  "address": { "address_line": "Plot 21, Industrial Area", "country_id": 1,
               "state_id": 14, "state_code": "27", "city": "Pune",
               "pincode": null, "google_location": null } }
```

`id` is the supplier id once Stage 1 was saved (an update). `gst_number` is sent
for an international supplier (the TIN) or when GST Applicable is Yes; otherwise
`null`.

### 7.11 Backend Processing — `VC::storeIdentity()`

1. Validate; take `address` out of `$data`.
2. `vendor_type` name sent → `VendorTypes::firstOrCreate(client_id, name)`
   (status Active) → `vendor_type_id`.
3. Edit with a **different** `vendor_type_id` → `SegmentGuard::vendorCommittedDocument()` → 422 if `po` / `spi`.
4. `vendor_behaviour` name → `VendorBehaviour::firstOrCreate(client_id, name)` → `vendor_behaviour_id`.
5. `normalizeSegmentIds(segment_ids, segment_id, client)` — keeps only ids whose `clm_segments.client_id` = the user's client; `segment_id` = the first kept id.
6. Country = `address.country_id`, else (edit) the saved primary address's country. India → domestic; another country → international; none → neither.
7. Not international and `gst_applicable = No` → `gst_number = null`.
8. International → TIN checks, upper-cased.
9. India → `gst_applicable` must be `Yes`.
10. (The state-code check — dead.)
11. Edit → `forUser()->findOrFail()`, `hierarchicalDenial`.
12. `assertGstUniqueForClient()` when `gst_applicable = Yes` and a number is sent.
13. Edit → segment removal guards (Section 13).
14. `DB::transaction`:
    * create: `new Vendor($data)`, `client_id`, `branch_id`, `created_by` from the user, `status='draft'`, `step_completed=1`, save; `SELECT … FOR UPDATE` on the `clients` row; `vendor_code = nextVendorCode(client, branch)` (max trailing number of every code of that client + branch, soft-deleted included, + 1 → `S-001`…); save.
    * update: `fill($data)`, `step_completed = max(…, 1)`, save.
    * `segments()->sync($segIds)`.
    * Confirmed orphan uploads deleted (never from this screen).
    * Address with any non-empty value → update the primary `vendor_addresses` row (or create one with `address_type='Registered Office'`, `is_primary=true`, `contact_name=''`).
15. `MasterBundleCache::bump()`; return `shape()`.

### 7.12 Database

* Read: `vendors`, `vendor_addresses`, `master_countries`, `master_vendor_types`, `master_vendor_behaviour`, `clm_segments`, `vendor_segments`, `vendor_gst_scrutiny`, `p2p_purchase_orders` / `p2p_supplier_invoices` (type lock), `clients` (row lock).
* Written — `vendors`: `company_name`, `legal_name`, `website`, `gst_applicable`, `gst_number`, `vendor_type_id`, `risk_level_id`, `vendor_behaviour_id`, `segment_id`, `supplier_category`, (create) `client_id`, `branch_id`, `created_by`, `status='draft'`, `step_completed=1`, `vendor_code`. `vendor_segments` (sync). `vendor_addresses` (primary row: `address_line`, `country_id`, `state_id`, `state_code`, `city`, `pincode`, `google_location`). Possibly a new `master_vendor_types` / `master_vendor_behaviour` row.

### 7.13 Response and UI

`{ "data": <shape()> }` (Section 13 lists the keys). The screen
keeps `data.id` as `vendorId`, `data.vendor_code` as the header code,
`savedSegmentRef = segment`, `savedVendorType = vendorType` (unlocks Map
Product / Service), toast *"Identity saved — Supplier identity details
captured"*, then the Contact Person Details tab. On error only
`errors.gst_number` is put under a field; the toast is *"Save failed — <server
message>"* (or *"Could not save supplier identity"*).


### 7.14 Code Walkthrough (function by function)

```
props: vendorId?, scope ('domestic'|'international'), initialStep?, initialKycTab?,
       vendorCodeHint?, canMapProducts?, prefill? (Convert to Supplier),
       convertSupplierId? (Convert to Supplier), onClose, onSubmit
  │
  ├─ master bundle: readVendorMasterBundle() → paint at once,
  │                  then GET /vendors/master-bundle → writeVendorMasterBundle()
  │                  hydrate(): Supplier Type ids, Risk Level, Supplier Behaviour
  │                  (master names, de-duplicated — see Section 7), segments (id, code,
  │                  name, regulatory_status), countries, states, state codes,
  │                  licence names, GST %
  ├─ useRuledSegments(): GET /clm/segment-rules — which segments have a rule, per
  │        origin (DOM / INT / +2 badges, greyed-out segments, segTypesById)
  ├─ in Stage 2 (or in edit mode), per selected segment:
  │        GET /clm/segment-rules/for-segment/{id}?document_type=domestic|international
  │        → the Stage 2 document rows; in parallel
  │        GET /clm/trade-doc-library/for-party/supplier?view=list&vendor_type=
  │        (its result is only used to filter `td` rows, and for-segment never
  │         returns a `td` key — so in practice it changes nothing on screen)
  ├─ GET /clm/segments?lite=1 — only when the Segment "+" is clicked
  │        (openSegmentAdd(): next code + existing names for the CLM form)
  ├─ edit: GET /vendors/{id} → fill every field + lock flags
  │        (vendor_type_lock, state_locked → stateLocked, locked_segments,
  │         locked_segment_reasons, segment_required_doc_keys, uploaded_doc_keys,
  │         segment_uploads for the Stage 2 rows)
  │        savedVendorType = the loaded type
  │        404 / error → "Load failed — Could not load the supplier — closing the form."
  └─ add: country fixed to India (domestic) / India removed (international)
```

```
step 1, tab 'identification'  → saveIdentity()   ok → tab 'address' (Contact Person Details)
step 1, tab 'address'         → saveContacts()   ok → step 2
step 2                        → bank tab with no bank?        → toast, stop
                                gst tab, domestic, no record? → toast, stop  (unreachable)
                                saveKyc()        ok → next KYC sub-tab
```

`goPrev()` walks back: KYC sub-tab → … → Contact Person Details →
Identification. On the last KYC sub-tab (`kycTabOrder.indexOf(kycTab) ===
kycTabOrder.length - 1`) the footer shows **only** **Save / Update Supplier** →
`finishSupplier()`. `kycTabOrder` = `KYC_TAB_ORDER` (`company, owner, license,
bank, gst`) with `gst` filtered out unless GST Applicable = Yes, so GST is always
last when present and Bank is last for an international supplier. Hence
`goNext()`'s GST check (*"…before continuing."*) can never run, and its Bank
check runs only for a domestic supplier; the reachable checks are
`finishSupplier()`'s *"…before saving the supplier."* / *"…before saving."*

Sanitising is **not** part of this function — it happens while typing, through
`applySanitizer()` with `sanitizeKycAddress` (Registered Office),
`sanitizeKycAlpha` (City, contact name), `sanitizeKycDesignation`, `sanitizeTin`
(TIN) and `handleCompanyNameChange()` (Company / Legal Name); each shows an
inline hint when it strips something.

```
validate on the client (all at once)
  required: Company Name, Company Legal Name, Supplier Type, Risk Level,
            Supplier Behaviour, ≥ 1 segment, Registered Office Address, Country,
            State, City; domestic: State Code (and it must be 1–2 digits)
  segments have a rule for this origin (once the rules are loaded)
  website (validateWebsite) · Google link must be a full https:// link
  international: TIN required + validateTin()
  gst_applicable = Yes: GSTIN required + validateGstin() + starts with State Code
  ├─ errors → flagErrors(): every message ends in "is required" → "Missing required
  │           fields — Please check: …"; otherwise "Invalid value" (one field) /
  │           "Please fix these fields" (several); stop. (The segment message
  │           "Select at least one supplier segment" does not end in "is required",
  │           so a missing segment always gives the second form.)
  │
POST /vendors/step/identity  { id?, names, vendor_type_id (vendor_type: null — the name is
                               only a fallback), risk_level_id, vendor_behaviour (NAME —
                               from the Supplier Behaviour master, Section 7),
                               segment_id (first), segment_ids, supplier_category
                               (default 'general'), gst_applicable, gst_number, address{…} }
  attempt():
  ├─ 409 requires_doc_confirmation → toast "Cannot remove segment…", put the saved
  │                                  segments back, return false (never re-sends with
  │                                  confirm_segment_doc_removal)
  ├─ any other error → only errors.gst_number is mapped onto a field; the toast is
  │                    "Save failed — <server message>" (e.g. the Supplier Type lock,
  │                    the segment-removal 422s, the TIN / GST messages)
  └─ 200 → vendorId, vendorCode, savedVendorType = vendorType   ← unlocks mapping
           toast "Identity saved — Supplier identity details captured"
```

**Server side — `VendorController::storeIdentity()`**

```
validate rules
$address = $data['address']; unset($data['address'])
resolve vendor_type NAME     → master_vendor_types (per tenant, firstOrCreate)
type lock?                   SegmentGuard::vendorCommittedDocument → 422
resolve vendor_behaviour NAME → master_vendor_behaviour (firstOrCreate)
normalizeSegmentIds()        → client's segments only; segment_id = first
international?  TIN rules  · India? gst_applicable must be Yes
GSTIN-starts-with-state-code check — reads $data['address'], already unset,
                               so it never fires (known bug)
edit: hierarchicalDenial()   → always null for a Vendor
assertGstUniqueForClient()
segment removal guards       product mapping → 422 · PO/SPI → 422 · orphan docs → 409
DB::transaction
   create: insert (draft, step 1) → lock clients row → nextVendorCode() → save
   update: fill + save
   sync vendor_segments · delete confirmed orphan uploads · upsert primary address
return { data: shape($vendor) }
```

### 7.15 Edge Cases and Known Gaps

* The GSTIN-starts-with-State-Code rule is browser-only (the server check is dead code).
* The "segment needs a rule for this origin" rule is browser-only; the server also silently drops a **global** segment (`client_id` NULL) that the bundle offers.
* `firstOrCreate` by name reuses an existing row of that name even if it is Inactive; a name that differs only in case or spacing creates a new master row (PostgreSQL compares case-sensitively). Picking a behaviour that comes from a **global** master row (`client_id` NULL) creates a tenant copy of it on save.
* `state_locked` (any PO) is not enforced by the server — Section 13.
* The server does not require a GSTIN for an Indian supplier (`gst_number` nullable; only `gst_applicable=Yes` is enforced).
* Order inside `storeIdentity()`: Supplier Type `firstOrCreate()` → **type-lock check** → Supplier Behaviour `firstOrCreate()` → TIN / GST / segment checks. So a save refused for the type lock can still have created a Type row (never a Behaviour row), and one refused for TIN / GST / segments (422 / 409) can have created both.
* `VendorBehaviour::firstOrCreate()` stores the user's `branch_id`; branch-scoped bundle reads (employees, branch users) of other branches don't see that row.
* A segment with no rule at all, already selected, saves without a warning (see the table above).

---

## 8. FEATURE 4 — STAGE 1: CONTACT PERSON DETAILS

### 8.1 Overview

The second Stage 1 tab saves the primary contact (together with the address)
and lets the user add extra contact persons. With `convert_supplier_id`, this
save is also the **Convert-to-Supplier link**.

### 8.2 Files Involved

| Layer | File · Function |
|---|---|
| Wizard | `AddVendorModal.tsx` → `saveContacts()`, `savePrimaryContact()`, `ContactAddPopup`, `saveContactDraft()` |
| API | `POST /vendors/{id}/step/contacts` (`_method=PUT`), `POST /vendors/{id}/contacts`, `POST /vendors/{id}/contacts/{contact}` (`_method=PUT`), `DELETE /vendors/{id}/contacts/{contact}` |
| Backend | `VC::storeContacts()`, `storeContact()`, `updateContact()`, `destroyContact()`, `validateContact()`, `absorbFile()`; `Vendor` `EnforcesUniqueEmail` |

### 8.3 Access

after Stage 1 is saved (`vendorId`), else *"Step blocked —
Save Identity information first."* Server: `forUser()->findOrFail()` (404),
`hierarchicalDenial` (never denies).

### 8.4 Step-by-Step Flow

1. **Primary Contact Person Details**: Contact Person Name, Designation,
   Contact No (domestic shows a fixed `+91`), Email, **WhatsApp Enabled?**
   (on by default), Attachment (business card).
2. **Save Contact** (`savePrimaryContact()`) or **Save & Next →** (`goNext()` →
   `saveContacts()`) — both make the same request. After **Save Contact** the
   card shows *"Saved — locked"*; clicking it shows *"Primary contact locked —
   Click the Edit icon on the primary row below to change it."* In edit mode the
   card opens locked when the saved contact is complete. The primary row's
   delete shows *"Primary contact locked — The primary contact can’t be deleted
   here."*
3. **+ Add More Contact Person** → `ContactAddPopup` (same fields) → **Save** →
   `saveContactDraft()`. Rows can be edited (same popup) and deleted.

### 8.5 Validations — browser

| Field | While typing | On save |
|---|---|---|
| Contact Person Name | `sanitizeKycAlpha` (letters, spaces, `. , ' -`, max 60) — *Only alphabetic characters are allowed* | required — *Contact Person Name is required* |
| Designation | `sanitizeKycDesignation` (letters, spaces, `. , ' / -`, max 60) — *Only letters, spaces, and . , - / are allowed* | required — *Designation is required* |
| Contact No | digits only (`digitsOnly`) | required — *Contact No is required*; `validateContactNumber()`: *Contact No must contain digits only (no spaces, +, or punctuation)* · domestic *Contact No must be exactly 10 digits (after +91) — you entered N* · *Contact No must start with 6, 7, 8 or 9 — Indian mobile numbers do not begin with X* · international *Contact No must be 7 to 15 digits* |
| Email | — | required — *Email is required*; `validateEmail()`: *Email is too long (max 255 characters)* · *Enter a valid email (e.g. name@example.com)* |
| Attachment | picker: JPG / PNG / WEBP / PDF, 2 MB | — |

`saveContacts()` also re-checks the address fields of Section 7 (Registered Office,
Country, Google Location, State, State Code, City) and `validatePincode()`
(*Pincode must be 6 digits and cannot start with 0*) — they ride in the same
request. `savePrimaryContact()` shows *"Missing required fields — Please fix the
highlighted fields"*; `saveContacts()` uses `flagErrors()`. The extra-contact
popup shows *"Missing required fields — Please fill: …"*, *"Invalid Contact No
— …"*, *"Invalid Email — …"*, and **Duplicate Email** — *"This email is already
used by another contact — each contact must have a unique email."* (checked
against the primary email and every other extra contact, lower-cased; browser
only).

### 8.6 Validations — server

`VC::storeContacts()`:

```
primary_address                   required|array
primary_address.address_type      nullable|string|max:64
primary_address.address_line      nullable|string|max:1000
primary_address.country_id        nullable|integer|exists:master_countries,id
primary_address.state_id          nullable|integer|exists:master_states,id
primary_address.state_code        nullable|string|max:32
primary_address.city              nullable|string|max:128
primary_address.pincode           nullable|string|max:16
primary_address.google_location   nullable|string|max:1000|regex:/^https?:\/\/[^\s]+$/i
primary_address.contact_name      required|string|max:255
primary_address.designation       nullable|string|max:128
primary_address.contact_no        nullable|string|max:32
primary_address.email             nullable|email|max:255
primary_address.whatsapp_enabled  nullable|boolean
primary_address.attachment_path   nullable|string|max:500
primary_attachment                nullable|file|mimes:jpg,jpeg,png,webp,pdf|max:2048
convert_supplier_id               nullable|integer
```

Then: `convert_supplier_id` not a New Supplier of this client, or converted into
another supplier → 422 `errors.convert_supplier_id` *This New Supplier cannot be
converted into this supplier.* On save the `Vendor` model's
`EnforcesUniqueEmail` (scope `vendor`, `tenant => false`) compares the
lower-cased `primary_email` with every other `vendors.primary_email` and
`p2p_suppliers.email` in **all** clients (soft-deleted rows ignored; this
supplier, New Suppliers converted into it and the one being converted are
excluded) → 422 `errors.primary_email` *This email address is already used by
another vendor or supplier in the system. Please use a different address.*

Extra contacts — `VC::validateContact()`: `contact_name required|string|max:255`,
`designation nullable|string|max:128`, `contact_no nullable|string|max:32`,
`email nullable|email|max:255`, `whatsapp_enabled nullable|boolean`,
`attachment nullable|file|mimes:jpg,jpeg,png,webp,pdf|max:2048`,
`attachment_path nullable|string|max:500`. No uniqueness check on the server.

### 8.7 API Requests

```
POST /api/vendors/31/step/contacts          (multipart; the route is PUT)
_method=PUT
primary_address[address_type]=Registered Office
primary_address[address_line]=Plot 21, Industrial Area
primary_address[country_id]=1
primary_address[state_id]=14
primary_address[state_code]=27
primary_address[city]=Pune
primary_address[pincode]=
primary_address[google_location]=
primary_address[contact_name]=Priya Sharma
primary_address[designation]=Manager
primary_address[contact_no]=9876543210
primary_address[email]=priya@abc.in
primary_address[whatsapp_enabled]=1
primary_attachment=<File>          OR   primary_address[attachment_path]=vendor_documents/31/contact-1a2b3c4d__card.pdf
convert_supplier_id=4              (Convert to Supplier only)
```

```
POST /api/vendors/31/contacts                  (multipart — add)
POST /api/vendors/31/contacts/88  _method=PUT  (multipart — edit)
contact_name=Ravi Kumar  designation=Accounts  contact_no=9123456780
email=ravi@abc.in (lower-cased by the browser)  whatsapp_enabled=1
attachment=<File>  |  attachment_path=<kept path>  |  remove_attachment=1 (no file kept)
DELETE /api/vendors/31/contacts/88
```

### 8.8 Backend Processing

* `storeContacts()`: validate → convert check (sets `Vendor::$convertingSupplierId`) → `DB::transaction`: delete the primary `vendor_addresses` row, `absorbFile('primary_attachment')` (or keep `attachment_path`), insert a new primary row (`is_primary=true`) built **only** from `primary_address[...]` (its `email` stored **as sent**), `vendors.primary_email = lower(trim(email))`, `step_completed = max(…, 1)`, delete the old card file if it changed → `finally` clear `$convertingSupplierId` → with `convert_supplier_id`, the Convert link (Section 18) → return `shape()`.
* `storeContact()`: `absorbFile('attachment')` → `VendorAddress::create(is_primary=false, …)` → 201.
* `updateContact()`: the row must be a non-primary row of this supplier (404); `remove_attachment=1` → no file; otherwise new file, or `attachment_path`, or the old one; old file deleted if replaced.
* `destroyContact()`: non-primary row only; hard delete + file delete.
* `absorbFile()` stores at `vendor_documents/{vendorId}/contact-{8 hex}__{safe name}.{ext}` on the `public` disk.

### 8.9 Database

written: `vendor_addresses` (primary row **deleted and
re-inserted**, so its id changes every save; extra rows inserted / updated /
deleted: `contact_name`, `designation`, `contact_no`, `email`,
`whatsapp_enabled`, `attachment_path`), `vendors.primary_email`,
`vendors.step_completed`; files under `vendor_documents/{id}/`. Read:
`vendors`, `p2p_suppliers` (email uniqueness, convert).

### 8.10 Response and UI

* `step/contacts` → `{ "data": <shape()> }`; the browser keeps
  `primary_address.attachment_path / attachment_url`, sets the saved-primary
  card, toast *"Contacts saved — Address & contact persons captured"*; Save &
  Next → Stage 2 (Company Due Diligence). Error → *"Save failed — <message>"*
  (or *"Could not save contacts"*).
* Extra contact → `{ "data": { "id", "contact_name", "designation",
  "contact_no", "email", "whatsapp_enabled", "attachment_path",
  "attachment_url" } }` (201 on add) → *"Contact saved — {name} added"* /
  *"Contact updated — {name} updated"*. Delete asks *"Delete Contact Person? —
  This contact person will be permanently deleted from this supplier. This
  action cannot be undone."* → `{ "message": "Contact deleted" }` → *"Contact
  deleted — Contact person removed"*. Removing an attachment in the popup asks
  *"Remove Attachment? — This attachment will be removed from this contact
  person. It is deleted for good once you save."*
* Table columns: Sr No · Name · Designation · Phone · Email · WhatsApp ·
  Attachment · Actions.


### 8.11 Code Walkthrough (function by function)

Builds `FormData` with `_method=PUT`, `primary_address[...]`, the attachment the
user picked on the primary card as `primary_attachment` (or
`primary_address[attachment_path]` to keep the saved one), and
`convert_supplier_id` (from the `convertSupplierId` prop) when converting. The
New Supplier's own business card is **not** sent here — only
`SourcingController::convertSupplier()` copies it, at the very end.

**Server — `VendorController::storeContacts()`:**

```
validate primary_address + primary_attachment + convert_supplier_id
convert_supplier_id?  P2p\Supplier in this client, not converted to ANOTHER vendor
                      else 422 "This New Supplier cannot be converted into this supplier."
                      Vendor::$convertingSupplierId = id   ← its email isn't a duplicate
DB::transaction
   delete the primary address row, absorbFile(primary_attachment), insert the new primary
   vendors.primary_email = lower-cased email; step_completed ≥ 1
   delete the old card file if it changed
finally  Vendor::$convertingSupplierId = null
convert_supplier_id and not yet linked to THIS vendor?
   DB::transaction                                    ← the Convert-to-Supplier link
      each SourcingProductSupplier (source='new', supplier_id = New Supplier):
         product already has this vendor as a 'master' row → delete it
         else → source='master', supplier_id = vendor, name = company_name
      New Supplier: converted_vendor_id, converted_at, converted_by
return { data: shape($vendor) }
```

Extra contacts are never touched here.

Extra contacts are saved one at a time from the popup —
`saveContactDraft()` → `POST /vendors/{id}/contacts`, or for an edit `POST
/vendors/{id}/contacts/{contact}` multipart with `_method=PUT` (and
`remove_attachment=1` when the card was removed); a duplicate email is caught
on the client first. Delete → `DELETE /vendors/{id}/contacts/{contact}`. The
bank popup works the same way (`saveBankDraft()`: `POST …/bank-accounts`, or
`POST …/bank-accounts/{bank}` with `_method=PUT`), though the bank table shows
no edit / delete control.

The **Save Contact** button on the primary card (`savePrimaryContact()`)
validates the contact fields and calls the same `saveContacts()` — so it also
sends `convert_supplier_id` and makes the Convert-to-Supplier link.

### 8.12 Edge Cases and Known Gaps

* Only the primary email is unique on the server (across **every** client); extra contacts' emails are checked in the browser only, and the primary email is **not** checked against the extra contacts' emails anywhere.
* The primary row is rebuilt only from `primary_address[...]`: a client that sends only the contact fields blanks the Stage 1 address (the screen always sends both).
* `vendor_addresses.email` keeps the casing sent (the example above sends lower case, as typed); only `vendors.primary_email` is lower-cased by the server. Extra contacts are lower-cased by both the browser and `validateContact()`.
* The route is `PUT`; the browser must send `POST` + `_method=PUT` (multipart).
* With `convert_supplier_id`, saving the contacts **is** the Convert link (Section 18).

---

## 9. FEATURE 5 — STAGE 2: COMPANY DUE DILIGENCE, OWNER KYC, TRADE LICENCE

### 9.1 Overview

Stage 2 lists the documents the segment rules ask for (per origin) and uploads
each one immediately. Older suppliers may show the legacy tables instead.

### 9.2 Files Involved

| Layer | File · Function |
|---|---|
| Wizard | `AddVendorModal.tsx` → `SupplierSegmentRefTable`, `SegmentRefUploadPopup`, `persistSegmentRefUpload()`, `validateVendorUpload()`, `DdTable` / `OwnerKycTable` / `TradeLicenseTable` (legacy) |
| API | `GET /clm/segment-rules/for-segment/{id}?document_type=`, `POST /segment-uploads/supplier/{id}` |
| Backend | `ClmSegmentRuleController::forSegment()`, `SDUC::store()`, `SDUC::resolveOwner()`, `storeUpload()` |

### 9.3 Access

Stage 2 opens only after `saveContacts()` succeeded (or in
edit mode with `initialStep=2`). `persistSegmentRefUpload()` refuses without a
supplier: *"Save Step 1 first — The supplier has to exist before documents can be
attached to it. Save Supplier Legal Identity, then upload."* Server
(`SDUC::resolveOwner()`): `{type}` must be in `TYPE_MAP` (else 404 *Unsupported
uploadable type: {type}*), `Vendor::findOrFail` (404), and the supplier's
`client_id` must equal the user's (else 404, no text). **No** branch, read-scope
or permission check.

### 9.4 Step-by-Step Flow

1. Stage 2 opens on **Company Due Diligence**. Sub-tabs: Company Due Diligence ·
   Owner KYC · Trade Licence · Bank Details · GST Scrutiny (GST only when GST
   Applicable = Yes). The pills can be clicked freely; nothing is saved when
   switching.
2. Each document tab shows the rows the segment rules ask for
   (`SupplierSegmentRefTable`), or — for an older supplier with legacy rows on
   that tab — the legacy table (below).
3. **Upload** → `SegmentRefUploadPopup` (*"Upload {Due Diligence | KYC | TRADE
   LICENSE} Document"*) → Issue Date, Expiry Yes / No (+ date), file → **Save**.
4. After upload the row offers **View**, **Download**, **Re-upload**.

### 9.5 Where the rows come from

```
for each selected segment (in parallel):
  GET /api/clm/segment-rules/for-segment/{segmentId}?document_type=domestic|international
  → { status: true, data: { rule, kyc: [...], dd: [...], tl: [...], qc: [...] } }
     each row: { id, code, name, status, authority, authority_list, expiry, validity, requirement: "M"|"O" }
  (a failed call counts as "no documents")
merge by code per category (mergeCat): first row wins; Mandatory if ANY segment says M
company tab ← dd · owner tab ← kyc · licence tab ← tl   (qc is merged, not shown)
```

`ClmSegmentRuleController::forSegment()`: 403 *No tenant context* without a
client; the segment is read in `MasterVisibility::applyReadScope`; the rule is
`clm_segment_rules` where `segment_code` = the segment's code (exact,
case-sensitive) and `document_type` = the requested one, `first()`; the library
rows come from `SegmentGuard::branchCatalogue()` (client + codes + branch or
NULL, no status filter).

### 9.6 Validations — browser

| Where | Rule | Message |
|---|---|---|
| File pick (`SegmentRefUploadPopup`) | not an executable / script (`FILE_DENY_EXT_RE`) | *Unsafe file type blocked — {name} — executable / script files are not allowed* |
| File pick | JPG / JPEG / PNG / WEBP / PDF (`IMG_PDF_*`) | *Unsupported file — Only JPG / JPEG / PNG / WEBP / PDF files are allowed* |
| File pick | ≤ 2 MB | *File too large — {name} exceeds the 2 MB limit* |
| Save | Expiry = Yes needs a date | *Expiry date required — Pick the expiry date, or switch Expiry to No.* |
| Save | expiry ≥ issue date | *Dates out of order — The expiry date cannot be earlier than the issue date.* |
| Save | a file (new, or the current one re-fetched) | *File required — Choose a document to upload.* · *Could not keep the current file — Please pick the document again to re-upload.* |
| Submit (`validateVendorUpload()`) | JPG / PNG / PDF / DOC / DOCX (`FILE_ALLOWED_*`) | *Unsupported file — Only JPG / PNG / PDF / DOC / DOCX files are allowed* — this is where a .webp is refused |
| Date pickers | Issue Date ≤ today; Expiry ≥ max(today, issue date) | (the picker blocks other days) |

### 9.7 Validations — server (`SDUC::store()`, default Laravel messages, no relabelling)

```
category     required|in:kyc,dd,tl,td,qc
doc_code     required|string|max:32
doc_name     required|string|max:255
requirement  nullable|in:M,O
issue_date   nullable|date|before_or_equal:today
expiry_date  nullable|date|after_or_equal:issue_date
attachment   nullable|file|max:2048|mimes:pdf,jpg,jpeg,png
```

No file and no existing row → 422 `{ "message": "The attachment field is
required.", "errors": { "attachment": ["Select a file to upload."] } }`.

### 9.8 API Request

```
POST /api/segment-uploads/supplier/31      (multipart)
category=dd
doc_code=DD-001
doc_name=GST Registration Certificate
issue_date=2026-01-10          (only when set)
expiry_date=2027-01-09         (only when Expiry = Yes)
attachment=<File>
```

`requirement` is never sent. A re-upload without a new file re-fetches the
current file and sends it again as a new upload.

### 9.9 Backend Processing — `SDUC::store()`

1. `resolveOwner('supplier', 31, 'edit')`.
2. Validate; `requirement` defaults to `O`.
3. Find the row by (`uploadable_type = App\Models\Vendor`, `uploadable_id`, `category`, `doc_code`).
4. `storeUpload()` → `segment_doc_uploads/supplier/{id}/{slug(category-doc_code)}-{random 8}.{ext}` on the `public` disk.
5. Existing row: old file deleted if replaced; update `doc_name`, `requirement`, `attachment_path`, `attachment_name`, `uploaded_by` (non-null ones) **and always** `issue_date`, `expiry_date` (a missing date clears it) → 200. New row: create with `client_id` = the supplier's client → 201. No transaction.
6. Return `{ data: <row>, vault: <vault payload> }`.

### 9.10 Database

written: `segment_doc_uploads` (`uploadable_type`,
`uploadable_id`, `client_id`, `category`, `doc_code`, `doc_name`,
`requirement='O'`, `attachment_path`, `attachment_name`, `issue_date`,
`expiry_date`, `uploaded_by`); `vendors` is not touched. Read:
`clm_segments`, `clm_segment_rules`, the CLM document libraries.

### 9.11 Response and UI

`{ "data": { "id", "category", "doc_code", "doc_name",
"requirement", "attachment_path", "attachment_url", "attachment_name",
"issue_date", "expiry_date", "uploaded_by", "created_at", "updated_at" },
"vault": {…} }`. The row switches to the saved file and dates;
`"{category}|{doc_code}"` is added to `uploadedKeys` (segment-removal guard).
No success toast. Error → *"Upload failed — <first error / message>"* or *"The
document could not be saved. Please try again."*; the popup stays open.
Download failure → *"Download failed — Could not download the file. Please try
again."* No search match → *"No documents match your search."*

### 9.12 Legacy tables (older suppliers)

When `ddRows` / `ownerRows` /
`licenseRows` (from `GET /vendors/{id}` → `due_diligence`, `owner_kyc`,
`trade_licenses`) is non-empty, that tab shows `DdTable` / `OwnerKycTable` /
`TradeLicenseTable` instead. Inline upload checks *"Unsupported file type —
Only JPG, JPEG, PNG or PDF files are allowed."* then `validateVendorUpload()`;
Remove asks *"Remove Due Diligence Document?"* / *"Remove Owner KYC Document?"* /
*"Remove Trade License?"* and only takes effect at the next `saveKyc()`. The
add popups (`DdAddPopup`, …) cannot be opened — the header add button exists
only on Bank and GST — and the empty-state texts name buttons that are not on
screen (*"Use “+ Add More Due Diligence” to begin."*).

### 9.13 What Save & Next does on these tabs

`saveKyc()` (Section 12). It blocks only
on a **legacy** DD row marked mandatory with no file (*"Upload required documents
— Missing file on: DD-001, DD-003"*). The segment-rule rows are **not**
checked.


### 9.14 Code Walkthrough (function by function)

| Function | Calls | Notes |
|---|---|---|
| Segment document rows | `GET /clm/segment-rules/for-segment/{id}?document_type=` per segment | Merged by code; Mandatory if any segment says so |
| `persistSegmentRefUpload()` | `POST /segment-uploads/supplier/{id}` | Uploads **immediately**; refuses before Stage 1 is saved (cannot happen in practice — Stage 2 needs a saved supplier) |
| `saveBankDraft()` | `POST /vendors/{id}/bank-accounts` (edit: `POST …/bank-accounts/{bank}` + `_method=PUT`, unreachable — no edit control) | Immediate |
| `saveGstDraft()` | `POST /vendors/{id}/gst-scrutiny` | Immediate; GSTIN copied from Stage 1 |
| `saveKyc()` | `POST /vendors/{id}/step/kyc` | Runs on **every** Stage 2 Save & Next (Bank and GST tabs included). Replace-all of the legacy DD / owner / TL lists. Refuses with *"Step blocked"* without a supplier id, and while a mandatory **legacy DD** row has no file — the segment-rule rows on screen are **not** checked. Server moves `draft` → `inactive` |

### 9.15 Edge Cases and Known Gaps

* Mandatory segment documents are not enforced anywhere in the wizard; the supplier simply shows **Non Compliant**.
* On a failed upload `persistSegmentRefUpload()` deletes `segmentRefUploads[refKey]`, so after a failed **re-upload** the row shows **Upload** until the form is reloaded, although the previously saved file is still on the server.
* Uploads are stored with `requirement='O'` (compliance reads M / O from the rules, but `SDUC::summary()` counts are wrong).
* The popup says WEBP is allowed; the browser then refuses it, and so would the server.
* The server does not check that `doc_code` belongs to the supplier's segment rules, and accepts a past expiry date (only the picker blocks it).
* The wizard reads rules by **segment code + exact document type**; compliance and the vault (`SegmentDocScope`) read by **segment id** and fall back to the other document type — the two can list different documents.
* `/segment-uploads/supplier/{id}` is reachable for a supplier of another **branch** of the same client.

---

## 10. FEATURE 6 — BANK DETAILS

### 10.1 Overview

At least one bank account is required before the supplier can be saved. Each
account is saved immediately from its popup.

### 10.2 Files Involved

| Layer | File · Function |
|---|---|
| Wizard | `AddVendorModal.tsx` → `openBankPopup()`, `BankAddPopup`, `saveBankDraft()`, `BankTable` |
| API | `POST /vendors/{id}/bank-accounts` |
| Backend | `VC::storeBankAccount()`, `validateBank()`, `vendorIsIndian()`, `absorbFile()` |

### 10.3 Access

Stage 2, **Bank Details** tab, **+ Add More Bank**. Server:
`forUser()->findOrFail()` (404), `hierarchicalDenial` (never denies).

### 10.4 Step-by-Step Flow

`openBankPopup()` → `BankAddPopup` *"Add Bank Details"*:
Bank Name, Branch, Account Number, IFSC Code (domestic) / SWIFT / BIC
(international), Branch Address (optional), Cancelled Cheque → **Save** →
`saveBankDraft()`. The table (`BankTable`): SR NO · BANK NAME · BRANCH · ACCOUNT
NO · IFSC CODE / SWIFT / BIC · BRANCH ADDRESS · PROOF ATTACHMENT; no actions
column. Empty: *"No bank records added yet."*

### 10.5 Validations — browser

| Field | While typing | On save (inline in the popup only) |
|---|---|---|
| Bank Name | `sanitizeKycName`, max 80 | *Bank Name is required* |
| Branch | `sanitizeKycAlphaNum`, max 60 (*Only letters and numbers are allowed*) | *Branch is required* |
| Account Number | domestic digits only, max 18 (*Only digits are allowed*); international letters / digits, max 34 (*Only letters and digits are allowed*) | *Account Number is required* · *Account Number must be 9–18 digits* / *Account Number must be 8–34 letters or digits, with no spaces* · *This account number is already added for this supplier.* |
| IFSC / SWIFT | upper-cased, max 11 | *IFSC Code is required* / *SWIFT / BIC is required* · *IFSC Code must be 11 characters (e.g. HDFC0000123)* · *SWIFT / BIC must be 8 or 11 characters: 6 letters then alphanumeric (e.g. HDFCINBB or HDFCINBBXXX)* |
| Branch Address | `sanitizeKycAddress`, max 200 | — |
| Cancelled Cheque | images / PDF picker | *Cancelled Cheque is required* |

`BankAddPopup.handleSave()` sets these as inline errors and **returns before
calling `onSave`** whenever one fails (the duplicate-account check included).
`saveBankDraft()` also contains toasts for the same cases (*"Missing field"*,
*"Invalid Account Number"*, *"Invalid IFSC Code"* / *"Invalid SWIFT / BIC"*,
*"Duplicate Account Number — …"*), but they are **unreachable** from the popup;
only its *"Step blocked"* guard and the server error toast can show.

### 10.6 Validations — server (`VC::validateBank()`)

international = the primary
address has a country that is not India (`vendorIsIndian()`; no country counts
as India).

```
bank_name, branch_name  required|string|max:255
account_number          required|regex:/^[0-9]{9,18}$/            (domestic)
                        required|regex:/^[A-Za-z0-9]{8,34}$/       (international)
ifsc                    required|regex:/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/                       (domestic)
                        required|regex:/^[A-Za-z]{6}[A-Za-z0-9]{2}([A-Za-z0-9]{3})?$/      (international)
branch_address          nullable|string|max:500
cheque                  nullable|file|mimes:jpg,jpeg,png,webp,pdf|max:2048
cheque_path             nullable|string|max:500
```

Custom messages: *Account Number must be 9–18 digits.* / *Account Number must be
8–34 letters or digits, with no spaces.* · *IFSC Code is invalid (format: 4
letters + 0 + 6 characters, e.g. HDFC0001234).* / *SWIFT / BIC is invalid (8 or
11 characters: 6 letters then alphanumeric, e.g. HDFCINBB or HDFCINBBXXX).*
(other rules: Laravel defaults with raw field names — the labels are passed as
an ignored 4th argument). Duplicate `(vendor_id, account_number)` → 422
*This account number is already added for this supplier.* (also under
`errors.account_number`).

### 10.7 API Request

```
POST /api/vendors/31/bank-accounts       (multipart)
bank_name=HDFC Bank  branch_name=Andheri  account_number=50100123456789
ifsc=HDFC0001234  branch_address=  cheque=<File>
```

### 10.8 Backend Processing

`storeBankAccount()`: validate → duplicate check →
`absorbFile('cheque')` → `vendor_documents/{id}/cheque-{8 hex}__{name}.{ext}` →
create with `ifsc` upper-cased, `created_by` → 201. (`updateBankAccount()` keeps
the old cheque when no file is sent; `destroyBankAccount()` force-deletes — both
unused by the screen.) No transaction.

### 10.9 Database

written: `vendor_bank_accounts` (`vendor_id`, `bank_name`,
`branch_name`, `account_number`, `ifsc` — the SWIFT code for an international
supplier, `branch_address`, `cheque_path`, `created_by`). Read: `vendors`,
`vendor_addresses`, `master_countries`.

### 10.10 Response and UI

201 `{ "data": { "id", "bank_name", "branch_name",
"account_number", "ifsc", "branch_address", "cheque_path", "cheque_url" } }` →
the row is appended, toast *"Bank saved — {bank} ({branch})"*. Error → *"Save
failed — <message>"* or *"Could not save bank"*.

### 10.11 Edge Cases and Known Gaps

no edit or delete from the table
(`openBankEdit` and `removeBankRow` are dead code — `BankTable` renders no
actions); the cheque is required only in the browser; the attachment cell has no
clear control.

---

## 11. FEATURE 7 — GST SCRUTINY

### 11.1 Overview

For a GST-applicable (Indian) supplier, at least one GST scrutiny record is
required before saving. The GSTIN comes from Stage 1.

### 11.2 Files Involved

| Layer | File · Function |
|---|---|
| Wizard | `AddVendorModal.tsx` → `openGstPopup()`, `GstScrutinyAddPopup`, `saveGstDraft()`, `GstScrutinyTable` |
| API | `POST /vendors/{id}/gst-scrutiny` |
| Backend | `VC::storeGstScrutiny()`, `validateGst()`, `assertGstNumberUnique()` |

### 11.3 Access

the tab exists only when GST Applicable = Yes (country
India). `openGstPopup()` also needs the Stage 1 GST Number: *"GST Number missing
— Set GST Applicable to “Yes” and enter the GST Number on Supplier
Identification (Stage 1) first."*

### 11.4 Step-by-Step Flow

**+ Add GST Scrutiny** → *"Add GST Scrutiny"*: GST Number
(read-only, from Stage 1, tooltip *"Comes from the supplier's GST Number on Stage
1 — change it there"*), GST Status (Active / Inactive, default Active), GST Last
Filing Date (≤ today), Previous Non-GST 2A Reflected Invoice (`sanitizeKycId`,
max 50 — *Only letters, digits, hyphens and slashes are allowed*), Red Flags
(`sanitizeKycAddress`, max 300) → **Save** → `saveGstDraft()`. Table
(`GstScrutinyTable`, read-only): SR NO · SCRUTINY DATE · GST NUMBER · STATUS ·
LAST FILING · PREV 2A INVOICE · RED FLAGS. Empty: *"No GST scrutiny entries added
yet."*

### 11.5 Validations

browser: *GST Number is required*, `validateGstin()`, *GST
Last Filing Date is required* — inline only: `GstScrutinyAddPopup.handleSave()`
returns before `onSave`, so the matching toasts in `saveGstDraft()` are
unreachable. Server
(`VC::validateGst()`, labels applied): `gst_number required|string|max:16`,
`status nullable|in:Active,Inactive`, `last_filing_date nullable|date` (no
future check), `prev_non_gst_2a_invoice nullable|string|max:255`,
`red_flags nullable|string|max:2000`; then `assertGstNumberUnique()` → 422 *GST
number {GST} is already registered to another supplier.* (`errors.gst_number`:
*This GST number is already registered to another supplier.*).

### 11.6 API Request

```json
POST /api/vendors/31/gst-scrutiny
{ "gst_number": "27ABCDE1234F1Z5", "status": "Active", "last_filing_date": "2026-10-20",
  "prev_non_gst_2a_invoice": null, "red_flags": null }
```

### 11.7 Backend Processing

upper-case the number → uniqueness (other suppliers'
`vendors.gst_number` and `vendor_gst_scrutiny` in the client) → create
(`status` default Active, `created_by`) → set `gst_number` on **every**
scrutiny row of this supplier → 201.

### 11.8 Database

written: `vendor_gst_scrutiny` (`vendor_id`, `gst_number`,
`status`, `last_filing_date`, `prev_non_gst_2a_invoice`, `red_flags`,
`created_by`); `vendors.gst_number` is **not** updated.

### 11.9 Response and UI

`{ "data": { "id", "gst_number", "status",
"scrutiny_date" (created date), "last_filing_date", "prev_non_gst_2a_invoice",
"red_flags" } }` → the row goes first, every row shows the new GSTIN; *"GST
scrutiny saved — {GSTIN}"*. Error → *"Save failed — <message>"* or *"Could not
save GST scrutiny"*.

### 11.10 Edge Cases and Known Gaps

rows can't be edited or deleted; the server
does not check that the number matches Stage 1 or that the supplier is
GST-applicable; the filing date "not in the future" is browser-only.

---

## 12. FEATURE 8 — SAVE & NEXT IN STAGE 2, AND SAVE / UPDATE SUPPLIER

### 12.1 Overview

Every Stage 2 **Save & Next** runs `saveKyc()`; the last tab's **Save / Update
Supplier** checks bank and GST, saves KYC and the product list, and closes the
wizard. This is also where the supplier's status moves.

### 12.2 Files Involved

| Layer | File · Function |
|---|---|
| Wizard | `AddVendorModal.tsx` → `goNext()`, `saveKyc()`, `finishSupplier()`, `saveProducts()` |
| Page | `Vendors.tsx` → `handleSave` |
| API | `POST /vendors/{id}/step/kyc`, `POST /vendors/{id}/step/products` |
| Backend | `VC::storeKyc()`, `VC::storeProducts()` |

### 12.3 Access

anyone in the wizard. Server checks as above.

### 12.4 Step-by-Step Flow and Browser Checks

* **Save & Next** on a Stage 2 tab (`goNext()`):
  * Bank tab with no bank → *"Bank Details required — Add at least one bank account before continuing."* — **domestic only** (for an international supplier Bank is the last tab, which shows only Save / Update Supplier).
  * GST tab with no record → *"… before continuing."* — **unreachable**: GST is always the last tab, which has no Save & Next.
  * `saveKyc()` → toast *"{tab title} saved — {tab subtitle}"* (e.g., for a domestic supplier, *"Supplier Bank Details saved — Account, IFSC, and cancelled cheque proof"*, although bank data is not in this call) → next tab.
* **Save Supplier / Update Supplier** on the last tab (`finishSupplier()`):
  1. No bank → *"Bank Details required — Add at least one bank account before saving the supplier."* and the Bank tab opens.
  2. GST Applicable = Yes, no scrutiny → *"GST Scrutiny required — Add at least one GST Scrutiny record for a domestic supplier before saving."* and the GST tab opens.
  3. `saveKyc({ silentToast: true })`.
  4. Mapped products in the form → `saveProducts()` → `POST /vendors/{id}/step/products` (the whole list) → *"Supplier saved — Products mapped — supplier is now Active"* (also in edit mode).
  5. *"Supplier saved"* / *"Supplier updated"* — *"{code} — {name} completed and saved."*
  6. `onSubmit(payload)` → the list's `handleSave` closes the wizard, `refresh({ silent: true })`, and navigates to `return` if the wizard came from a deep link.

### 12.5 API Request — `saveKyc()`

```
POST /api/vendors/31/step/kyc          (multipart)
due_diligence[0][code]=DD-001  [document_name]=…  [issuing_authority]=…  [expiry]=…  [mandatory]=1
  dd_files[0]=<File>   OR   due_diligence[0][existing_path]=vendor_documents/31/dd-1a2b3c4d__cert.pdf
owner_kyc[0][code|document_name|issuing_authority|document_number|issue_date?|expiry|status]
  owner_files[0] | owner_kyc[0][existing_path]
trade_licenses[0][code|license_type_id (positive int only)|license_number|issuing_authority|issue_date?|expiry_date?]
  tl_files[0] | trade_licenses[0][existing_path]
```

For a supplier with no legacy rows the body is empty — the call still runs.
Browser refusal before sending: *"Step blocked — Save Identity information
first."* / *"Upload required documents — Missing file on: …"*.

### 12.6 Server validation — `VC::storeKyc()`

(labels applied): `due_diligence.*.document_name required|max:255`, `due_diligence.*.code max:32`, `due_diligence.*.expiry string|max:32`, `due_diligence.*.mandatory boolean`, `due_diligence.*.existing_path max:500`, `owner_kyc.*.document_name required`, `owner_kyc.*.document_number max:128`, `owner_kyc.*.issue_date date`, `owner_kyc.*.status in:Active,Inactive`, `trade_licenses.*.license_type_id exists:master_license_name,id`, `trade_licenses.*.license_number max:128`, dates `date`, every file `mimes:jpg,jpeg,png,webp,pdf|max:2048`.

### 12.7 Backend Processing — `storeKyc()`

`DB::transaction`: delete old
`vendor_documents` / `vendor_owners` files not echoed as `existing_path` →
`forceDelete` every `vendor_documents` (dd and tl) and `vendor_owners` row →
re-create from the request (`absorbFile()` → `vendor_documents/{id}/{dd|owner|tl}-…`)
→ `step_completed = max(…, 2)`, `status` `draft` → `inactive` → `{ data:
shape() }`.

### 12.8 Status transitions (`vendors.status`, never shown on screen)

| Event | `status` | `step_completed` |
|---|---|---|
| `storeIdentity()` create | `draft` | 1 |
| `storeKyc()` (first Stage 2 Save & Next, even with no document) | `draft` → `inactive` (an `active` supplier stays `active`) | max(·, 2) |
| `storeProducts()` with ≥ 1 product — from **any** status (Map Product works in Add mode right after Stage 1, so `draft` → `active` happens) | `active` | 4 |
| `ProductController::storeVendors()` (Product side → Map Supplier; offers Material/ Goods suppliers only) | `active` | max(·, 4) |

So the sequence is not strictly `draft` → `inactive` → `active`.
| `storeServices()` | unchanged | unchanged |

### 12.9 Database

written: `vendor_documents`, `vendor_owners`, `vendors`
(`status`, `step_completed`), plus `vendor_product_mappings` /
`product_vendor_maps` / `products` through `saveProducts()` (Section 14).


### 12.10 Code Walkthrough (function by function)

```
no bank?                   → toast, jump to Bank tab
domestic and no GST row?   → toast, jump to GST tab
saveKyc({ silentToast })
productMappings non-empty  → saveProducts()
toast "Supplier saved / updated"
onSubmit(payload)          → the list closes the wizard and refresh()es
```

### 12.11 Edge Cases and Known Gaps

* A supplier reaches `inactive` and can be "saved" with every mandatory document missing.
* `saveKyc()` replaces the legacy lists on every tab click; `existing_path` is not checked to belong to this supplier.
* With mapped products, **Update Supplier** re-posts the whole product list, so it inherits every `storeProducts()` 422 — e.g. one old mapping to a product that has since lost its GST blocks the whole update (Section 14).
* A service supplier never becomes `active` through the screens. An FFD / untyped supplier can — through `MappedProductsViewPopup` when it already has a product count > 0 (no Supplier Type check, Section 14).

---

## 13. FEATURE 9 — EDIT SUPPLIER AND ITS LOCKS

### 13.1 Overview

Edit reopens the same wizard filled from `GET /vendors/{id}`. Some fields are
locked once the supplier is on a Purchase Order / Supplier Invoice, and a
segment can't be removed while it is in use.

### 13.2 Files Involved

| Layer | File · Function |
|---|---|
| Page | `Vendors.tsx` → row **Edit**, `?edit=<id>&return=<path>` |
| Wizard | `AddVendorModal.tsx` → edit load, `canonicalSupplierType()`, `typeUnsaved`, `savedVendorType`, `MasterMultiSelect` `onChange` |
| API | `GET /vendors/{id}`, `POST /vendors/step/identity` |
| Backend | `VC::show()` (lock flags), `SegmentGuard::vendorCommittedDocument()`, `vendorLockSources()`, `blockedByProductMapping()`, `blockedByCompletedDocs()`, `orphanUploads()` |

### 13.3 Access

any user on the list (**Edit** on a row, or the deep link
`?edit=<id>&return=<path>`). Server: `VC::show()` → `forUser()->findOrFail()`
(404).

### 13.4 Step-by-Step Flow

1. `GET /vendors/{id}` → every field is filled; Supplier Type through
   `canonicalSupplierType()` (an older "Material / Goods" matches the fixed
   option); `savedVendorType` = that type; Supplier Behaviour = the saved
   **name**; Supplier Category matched on value or label (default `general`);
   segments from `segment_ids`; the legacy DD / Owner / TL lists; banks; GST rows
   (newest first); product mappings.
2. The header reads **Edit Supplier — S-xxx**; buttons **Update & Next →** /
   **Update Supplier**. The steps are the same as Add (Section 7–Section 12).
3. Load failure → *"Load failed — Could not load the supplier — closing the
   form."* and the wizard closes.

### 13.5 The lock flags (`VC::show()`)

| Flag | Computed from | Screen effect |
|---|---|---|
| `vendor_type_lock` | `SegmentGuard::vendorCommittedDocument()`: a non-deleted PO with `LOWER(status)` in `submitted, sent for sign, signed, approved` → `po`; else an SPI in `mapped, grn_pending, closed` → `spi`; else `null` | Supplier Type disabled; click → *"Can’t change this — This supplier is already on a Purchase Order / a Supplier Invoice, so its Supplier Type is fixed."* |
| `state_locked` | **any** `p2p_purchase_orders` row of the supplier (tenant scope lifted; drafts count) | Country, State, State Code and GST / TIN locked; tooltip *"Locked — this supplier is mapped to a Purchase Order"*; click → *"Can’t change this — This supplier is already used in a Purchase Order."* |
| `locked_segments`, `locked_segment_reasons` | `vendorLockSources()` (segments of products on committed POs / SPIs) and `productMappingSegmentNames()` (segments of mapped products), mapped to ids; reason `po` > `spi` > `product` | Removing it is undone with a toast (below) |
| `segment_required_doc_keys` | `{segId: ["cat|code", …]}` from `SegmentGuard::docKeys()` (every code of the segment's rules, M and O) | With `uploaded_doc_keys`: a segment with **any** of its documents uploaded can't be removed |
| `uploaded_doc_keys` | `segment_doc_uploads` of the supplier, `"cat|code"` | — |
| Domestic country | (not a flag) `countryScopeLocked` | *"Country is fixed — This is a domestic supplier — GST and State Code are tied to India. Changing the country would change which documents apply, so it is set at creation."* |

### 13.6 Removing a segment — browser (`MasterMultiSelect` `onChange`)

the segment
is put back and one toast per reason: *"Cannot remove segment — {names} — used
on a Purchase Order."* · *"… — used on a Supplier Invoice."* · *"… — has a mapped
product. Unmap it first."* · *"… — has uploaded documents. Delete them in KYC /
Due Diligence first."*

### 13.7 Removing a segment — server (`storeIdentity()`, edit only, in order)

| Check | Status | Message |
|---|---|---|
| `SegmentGuard::blockedByProductMapping()` | 422 | *This Segment cannot be removed because the Supplier is currently associated with one or more Products under this Segment. Please remove the Product dependency before removing this Segment.* (`errors.segment_ids`: *Segment(s) mapped to a supplier product cannot be removed: X.*) |
| `blockedByCompletedDocs()` | 422 | *Cannot remove X — a product on a Purchase Order or Supplier Invoice belongs to it.* (`errors.segment_ids`: *Segment(s) used by a PO / Supplier Invoice product cannot be removed: X.*) |
| `orphanUploads()` (documents only the removed segments use) and no `confirm_segment_doc_removal` | **409** | `{ "requires_doc_confirmation": true, "message": "Removing this segment will delete N document(s) used only by it. Shared documents are kept. Confirm to proceed.", "orphan_documents": [{ "id", "name", "category" }] }` |

`saveIdentity()` catches the 409: *"Cannot remove segment — A document is /
Documents are uploaded against a segment / segments you removed: {list}. Delete
it / them in KYC / Due Diligence first, then remove the segment."* and puts the
saved segments back. It never re-sends with `confirm_segment_doc_removal=1`.

### 13.8 Supplier Type and mapping

`typeUnsaved = squashType(vendorType) !==
squashType(savedVendorType)` (spaces and case ignored). While it is true the
header **Map Product / Service** button is disabled (*"Supplier Type changed —
click Update & Next to save it, then map products or services"*); which popup
opens always follows `savedVendorType` (Section 14, Section 15).

### 13.9 `GET /vendors/{id}` response

`{ "data": { id, vendor_code, company_name,
legal_name, website, gst_applicable, gst_number, status, step_completed,
client_id, branch_id, created_by, primary_email, vendor_type_id,
vendor_type_name, risk_level_id, risk_level_name, vendor_behaviour_id,
vendor_behaviour_name, segment_id, segment_name, segment_ids[], segments[],
compliance_behaviour_id, compliance_behaviour_name, supplier_category,
classification_id, classification_name, primary_address{…}, extra_contacts[],
due_diligence[], trade_licenses[], owner_kyc[], bank_accounts[],
gst_scrutiny[], product_mappings[], created_at, updated_at, locked_segments,
locked_segment_reasons, state_locked, vendor_type_lock,
segment_required_doc_keys, uploaded_doc_keys }, "segment_uploads": { data[],
by_category, count } }`.


### 13.10 Code Walkthrough (function by function)

```ts
savedVendorType   // set on load and after a successful saveIdentity()
typeUnsaved = squashType(vendorType) !== squashType(savedVendorType)
```

Disabled while `typeUnsaved`, before Stage 1 is saved, or for a type that maps
nothing. Which popup opens is decided from `savedVendorType`:
`Material/ Goods` → products; `serviceBucketOf(savedVendorType)` → services.

### 13.11 Edge Cases and Known Gaps

* `state_locked` is **UI only** — the server accepts a country / state / GST change on a supplier with a PO.
* The browser forbids removing a segment with **any** uploaded document (even one another segment also needs); the server only objects to documents no remaining segment uses.
* Segment PO / SPI locks need a **committed** document (`vendorLockSources()` filters `PO_COMMITTED` / `SPI_COMMITTED`); a draft PO locks the address (`state_locked`) but no segment.
* `segment_required_doc_keys` is resolved per segment **name** (`SegmentGuard::docKeys($clientId, $s->name)` → `resolveIds()`), not by id.
* The Supplier Type `LockField` tooltip is always *"Locked — this supplier is mapped to a Purchase Order"*, also when `vendor_type_lock` is `spi` (the click toast is correct).
* International supplier on edit: `scopedCountryOpts` still excludes India, so the country can only change to another foreign country.
* The type lock needs a **committed** PO / SPI; the address lock needs **any** PO.

---

## 14. FEATURE 10 — MAP PRODUCTS

### 14.1 Overview

A **Material/ Goods** supplier is linked to products with a purchase price and
GST. The wizard and the list each have a Mapped Products popup; both save the
**whole** list (replace-all).

### 14.2 Files Involved

| Layer | File · Function |
|---|---|
| Wizard | `AddVendorModal.tsx` → `MappedProductsPopup`, `AddProductMappingPopup`, `saveMapDraft()`, `persistMappings()`, `useMappedProductsPaging()` |
| List | `MappedProductsViewPopup` → `loadMappableProducts()`, `saveMapping()` |
| API | `GET /products?per_page=500&lite=1`, `GET /vendors/{id}/product-mappings`, `POST /vendors/{id}/step/products` |
| Backend | `VC::storeProducts()` |

### 14.3 Key Code

```php
// VendorController::storeProducts() — CS-2327
$noGst = \App\Models\Product::whereIn('id', $productIds)->whereNull('gst_id')->pluck('name', 'id');
if ($noGst->isNotEmpty()) {
    return response()->json([
        'message' => 'These products have no GST rate and cannot be mapped to a supplier — set a GST on the product first: '.$noGst->values()->implode(', ').'.',
        'errors'  => ['mappings' => ['One or more products have no GST rate mapped.']],
    ], 422);
}
// … then, in a transaction:
$vendor->productMappings()->forceDelete();
```

**Processing Explanation:**
1. The GST check runs over the **whole** list sent — one old mapping to a product without GST blocks every save.
2. Every existing mapping is then hard-deleted and re-created from the list (replace-all).

### 14.4 Access

* Wizard: the header **Map Product / Service** button (`avm-map-btn`) — hidden
  when the caller passes `canMapProducts={false}` (Add Product "+", Service
  Management, Sourcing Tracker Supplier Master form and Convert, Bulk Sourcing
  Convert, Create PO's Add Supplier flow). Disabled, in this order of tooltip:
  no `vendorId` — *"Save the Supplier Legal Identity step first to map products
  or services"*; `typeUnsaved` — *"Supplier Type changed — click Update & Next to
  save it, then map products or services"*; a type that maps nothing —
  *"Products or services can’t be mapped to this Supplier Type"*. Material/
  Goods → *"Map products to this supplier"*.
* List: the product count (> 0) of a non-service row → `MappedProductsViewPopup`.
* Server: `VC::storeProducts()` → `forUser()->findOrFail()` (404), `hierarchicalDenial` (never denies).

### 14.5 Step-by-Step Flow

| | Wizard (`MappedProductsPopup` + `AddProductMappingPopup`) | List (`MappedProductsViewPopup`) |
|---|---|---|
| Title | *Mapped Products* | *Mapped Products — S-xxx* (sub *"{name} · Products linked to this supplier with price & GST"*) |
| Rows | the wizard's `productMappings` (from `GET /vendors/{id}`) | `GET /vendors/{id}/product-mappings` |
| Rows per page | 3 | 10 (`LIST_MAPPED_PAGE_SIZE`) |
| Add button | *Map Product* (body) | *Map New Product* (header) |
| Empty | *No products mapped yet. Click "Map Product" to begin.* | *No products mapped yet. Click "Map New Product" to begin.* · load failed: *"Load failed — Could not load the mapped products for this supplier."* and *"Could not load the mapped products. Close and try again."* |

Columns: SR. NO · PRODUCT · PRODUCT CODE · HSN / SAC · SEGMENT · PRICE (₹) · GST %
· GST (₹) · TOTAL (₹) · ACTIONS (Edit only — `allowRemove={false}`). Search
(`useMappedProductsPaging()`): name, code, HSN, segment, and every amount as
`1212`, `1212.00`, `1,212`, `₹1,212`, plus `18%`; no match → *No mapped products
match "…".* After an add the popup jumps to the last page.

Form: Product Name (required; "+" opens Add Product — hidden and locked when
editing), Product Code / HSN / Segment (auto), Purchase Price (₹, required), GST
% (auto from the product, locked), GST Amount = price × GST % ÷ 100, Total =
price + GST.

### 14.6 Product options

`GET /products?per_page=500&lite=1`
(`fetchProductOptsIfNeeded()` / `loadMappableProducts()`): the server caps
`per_page` at 200 (newest first), no status filter; rows without a segment are
dropped; then the picker leaves out products already mapped and, when the
supplier has segments, products of other segments (by segment id). GST % =
`gst_percentage.percentage` of the product's `gst_id` row, empty when the
product has no GST.

### 14.7 Validations — browser

| Rule | Wizard (`saveMapDraft()`) | List (`saveMapping()`) |
|---|---|---|
| Product picked | *Missing field — Pick a Product Name* | same |
| Product has a GST rate (CS-2327, commit `da7a6d271`): GST % empty = no `gst_id`; a real 0 % passes | *GST required — {code} has no GST rate — set a GST on the product before mapping it to a supplier.* | **not checked** — the server 422 below |
| Product in one of the supplier's segments | *Segment mismatch — {code} is in a segment this supplier isn't onboarded for.* | (options already filtered) |
| Price entered | *Missing field — Purchase Price is required* | *Missing field — Enter a Purchase Price* |
| Price ≥ 0 | *Invalid price — Purchase Price must be a non-negative number* | — |
| Not mapped twice | *Already mapped — {code} is already mapped to this supplier* | (options already filtered) |

"+" Add Product → after save: *"Product created — Select {name} in Product Name
to map it."* · *"Not in the list yet — The product was saved, but it needs a
segment before it can be mapped."* · *"Not in the list yet — {name} is in a
segment this supplier isn't onboarded for."* (list version: *"… a segment {code}
isn't onboarded for."*, and *"Could not refresh — The product was saved — reopen
this form to select it."*).

### 14.8 Validations — server (`VC::storeProducts()`, labels applied)

```
mappings                     present|array
mappings.*.product_id        required|integer|exists:products,id
mappings.*.batch_serial_lot  nullable|string|max:128
mappings.*.purchase_price    required|numeric|min:0
mappings.*.gst_percentage    nullable|numeric|min:0
mappings.*.gst_amount        nullable|numeric|min:0
mappings.*.total_amount      nullable|numeric|min:0
```

* A product twice → 422 `{ "message": "A product can only be mapped once per supplier." }` (no `errors`).
* **CS-2327** — any listed product with `products.gst_id IS NULL` → 422 `{ "message": "These products have no GST rate and cannot be mapped to a supplier — set a GST on the product first: <names>.", "errors": { "mappings": ["One or more products have no GST rate mapped."] } }`.

### 14.9 API Request

always the **whole** list (replace-all):

```json
POST /api/vendors/31/step/products
{ "mappings": [
    { "product_id": 5,  "batch_serial_lot": null, "purchase_price": 100,
      "gst_percentage": 18, "gst_amount": 18, "total_amount": 118 },
    { "product_id": 12, "batch_serial_lot": null, "purchase_price": 2500,
      "gst_percentage": 0,  "gst_amount": 0,  "total_amount": 2500 } ] }
```

### 14.10 Backend Processing — `storeProducts()`

1. Validate; duplicate check; GST check (both over the whole list).
2. `DB::transaction`:
   1. `productMappings()->forceDelete()` — **every** mapping of the supplier.
   2. For each row: `VendorProductMapping::create(vendor_id, product_id, batch_serial_lot, purchase_price, gst_percentage ?? 0, gst_amount ?? 0, total_amount ?? purchase_price, created_by)` — no `origin` / `currency_code` / `exchange_rate` / `inr_amount`.
   3. `ProductVendorMap::updateOrCreate(product_id, vendor_id)` with the supplier snapshot (`vendor_code`, `vendor_name`, `vendor_website`, `contact_person`, `contact_no`, `email`, `designation`) + prices + `map_date` = today.
   4. Mapped products → `status='active'`, `step_completed = GREATEST(step_completed, 4)`.
   5. `product_vendor_maps` rows of this supplier for products no longer listed → deleted.
   6. Non-empty list → `vendors.step_completed = 4`, `status = 'active'`.
3. Return `{ data: shape() }`.

### 14.11 Database

written: `vendor_product_mappings` (force-deleted and
re-created), `product_vendor_maps`, `products.status` / `step_completed`,
`vendors.status` / `step_completed`. Read: `products` (`exists`, `gst_id`),
`vendor_addresses` (snapshot).

### 14.12 Response and UI

* Wizard: `persistMappings()` → on success the row list updates and the popup closes; *"Product mapped — {code} {name} added"* / *"Mapping updated — {code} {name} updated"*; failure *"Save failed — <message>"* (or *"Could not save the product mapping"*). Without a `vendorId` nothing is sent (kept in the form until Save Supplier) — unreachable in practice, the button needs a saved Stage 1.
* List: *"Product mapped — {name} is now linked to S-xxx."* / *"Mapping updated — {name} has been updated for S-xxx."*; failure *"Save failed — <message>"* (or *"Could not save the product mapping"*), the form stays open; the list refreshes silently.


### 14.13 Code Walkthrough (function by function)

Two components share one paging hook:

| Component | Opened from | Rows / page |
|---|---|---|
| In-wizard popup (inside `AddVendorModal`) | Map Product / Service in the Edit header | 3 |
| `MappedProductsViewPopup` | The list's count | 10 |

#### `useMappedProductsPaging(rows, pageSize)`

```ts
haystacks = useMemo(rows → one lower-cased string per row:
   name, code, formatted code, HSN, segment,
   price / GST / total as 1212 · 1212.00 · 1,212 · ₹1,212, and "18%")
filtered  = rows where haystack.includes(q)
page      = clamp; after an add, jump to the last page and clear the search
```

Built once per row list — typing does not rebuild the search text.

#### Saving a product

```
wizard  saveMapDraft()                 validate: product, product has a GST rate (CS-2327,
                                                 da7a6d271), segment matches, price
                                                 entered and ≥ 0, not already mapped
        → persistMappings(list)        no vendorId yet? → no request, kept in the form
                                       else POST /vendors/{id}/step/products
        later: finishSupplier() → saveProducts() posts the whole productMappings list
list    saveMapping()                  validate: product picked, price entered — that's all
                                                 (the options, mappableOpts, already
                                                 exclude mapped / out-of-segment products;
                                                 no GST pre-check — the server's GST 422
                                                 is what the user sees)
        → POST /vendors/{id}/step/products { mappings: mappingsPayload(next) }
both:   list = every current mapping + the new / edited one       ← REPLACE-ALL
```

Product options come from `GET /products?per_page=500&lite=1`
(`loadMappableProducts()` in the list popup, `fetchProductOptsIfNeeded()` in the
wizard): rows with a segment only, no status filter, and the server caps
`per_page` at 200.

`removeMapRow()` (confirm *"Remove Mapped Product?"* → the list minus that row →
`persistMappings()`, replace-all) exists, but is only wired to the old Step 3
table (no caller opens Step 3) and to the paged table, which renders it with
`allowRemove={false}` — so there is no reachable Unmap for products.

**Server — `VendorController::storeProducts()`:** duplicates → 422; any listed
product with `products.gst_id` NULL → 422 (CS-2327 — checked over the **whole**
list, so one old mapping to a product without GST blocks every later save); in a transaction
hard-delete all the supplier's mappings, re-create them (without
origin / currency / rate / ₹ amount), mirror to `product_vendor_maps` (removing
rows no longer listed), activate **every** listed product (inactive ones too),
and set the supplier `active` / step 4 when the list is non-empty — from any
status. The GST values are stored as sent, and there is no Supplier Type check.

### 14.14 Edge Cases and Known Gaps

* **No Unmap** — `removeMapRow()` exists but the table renders with `allowRemove={false}`.
* Replace-all: every save re-creates every mapping (new ids, new `created_by`) and wipes the Product side's `origin` / `currency_code` / `exchange_rate` / `inr_amount`.
* The GST check runs over the whole list: a product that lost its GST after it was mapped blocks every later add / edit, and **Update Supplier** (which re-posts the list).
* The list popup has no GST pre-check (the user sees the server message); the wizard's pre-check is skipped for a product that is not in the 200 loaded options.
* If `GET /vendors/{id}/product-mappings` failed, the list popup still lets the user add, and the replace-all save then **deletes every existing mapping** except the new one.
* The server does not check the product's tenant, segment or status, nor the supplier's **Supplier Type**: an FFD / untyped supplier whose list count is > 0 opens `MappedProductsViewPopup`, whose **Map New Product** has no type check either, so more products can be mapped to it (and it becomes `active`).
* `storeProducts()` stores the client's `gst_percentage`, `gst_amount`, `total_amount` as sent — no recompute from the product's GST.
* Product mappings have no currency: an **international** supplier's products are priced in ₹ with the product GST, and the CS-2327 no-GST block applies to it too.
* Every listed product is set `active` on every save (including Save Supplier) — an inactive product is re-activated.
* `productMappings()->forceDelete()` runs through the relation (soft-delete scope), so already soft-deleted mapping rows are not removed.
* `ProductController::storeSales()` (the product's GST step) rewrites `gst_percentage` / `gst_amount` / `total_amount` on every `vendor_product_mappings` row of that product when its GST is saved — a fourth writer besides `storeProducts()`, `storeVendors()` and `updateVendorMapPrice()` / `destroyVendorMap()`.

---

## 15. FEATURE 11 — MAP SERVICES

### 15.1 Overview

A supplier of one of the eight service types is linked to services of its
bucket, with domestic (GST) or international (currency) pricing. Saves are
replace-all; Unmap sets the mapping inactive.

### 15.2 Files Involved

| Layer | File · Function |
|---|---|
| Popup | `AddVendorModal.tsx` → `MappedServicesPopup` (`load()`, `catalogOf()`, `save()`, `unmap()`, `servicePayload()`); list wrapper `MappedServicesViewPopup` |
| Helpers | `serviceMapping.ts` → `serviceBucketOf()` |
| API | `GET /p2p/services`, `GET /p2p/services/master-bundle`, `GET /vendors/{id}/service-mappings`, `POST /vendors/{id}/step/services`, `PATCH` / `DELETE /vendors/{id}/service-mappings/{map}` |
| Backend | `VC::storeServices()`, `updateServiceMapping()`, `destroyServiceMapping()`, `SSM::assertServes()`, `priceFields()`, `completeStageTwo()`, `serviceEditDenial()` |

### 15.3 Key Code

```php
// ServiceSupplierMapping::assertServes()
[$st, $cls] = $this->vendorServiceType($type);
if ($st === $service->service_type && ($cls ?: null) === ($service->classification ?: null)) {
    return;
}
$message = match (true) {
    $type === null => 'Set this supplier\'s Supplier Type first — only a supplier whose type serves '.$wanted.' can be mapped to '.$service->code.'.',
    $st === null => 'A '.$typeName.' supplier cannot supply a service. Only a supplier whose type serves '.$wanted.' can be mapped to '.$service->code.'.',
    default => 'This supplier\'s type ('.$typeName.') does not serve '.$wanted.' — '.$service->code.' needs a '.$wanted.' supplier.',
};
throw ValidationException::withMessages([$field => [$message]]);
```

```php
// ServiceSupplierMapping::completeStageTwo()
if ((int) $service->step_completed >= 2 && $service->status !== 'draft') {
    return;
}
$service->step_completed = max((int) $service->step_completed, 2);
if ($service->status === 'draft') {
    $service->status = 'active';
}
```

**Processing Explanation:**
1. The supplier's type must serve the service's type **and** classification; otherwise one of three messages is raised.
2. Mapping a supplier finishes the **service's** Stage 2 and turns a draft service active — the supplier's own status is never changed.

### 15.4 Access

* Wizard: the same header button — enabled for a saved type with
  `serviceBucketOf(savedVendorType)` set → *"Map services to this supplier"*.
* List: the service count, only when > 0 (the first service of a supplier can be
  mapped only from the wizard).
* Server: `editableVendor()` (`forUser` 404; `hierarchicalDenial` never denies a
  supplier); then per **service** `SSM::serviceEditDenial($user, $service,
  'edit')` → 403: an employee whose client and branch match the service's branch
  is allowed; otherwise `hierarchicalDenial` on the Service — *"You cannot edit
  this record — employees can only manage rows they created themselves."* or
  *"You cannot edit this record — it was created by {a Super Admin | a Client
  Admin | a Client user | another Branch}."* `POST step/services` prefixes
  `"{SERVICE CODE}: "` and checks every listed **and** every dropped active row;
  `PATCH` / `DELETE` return the message alone (DELETE also says "edit").

### 15.5 Bucket (Supplier Type → services)

`serviceBucketOf()` (browser, by name,
spaces / case ignored) and `SSM::VENDOR_TYPE_BY_NAME` (server, used only when
`master_vendor_types.service_type` is empty):

| Supplier Type | `service_type` | `classification` |
|---|---|---|
| Soft Service Provider | `soft_digital` | — |
| Trackable Services / Consumable Services | `self_consumable` | `trackable` / `consumable` |
| Professional / Utility / Facility / Maintenance / Outsourcing Services | `other_operational` | `professional` / `utility` / `facility` / `maintenance` / `outsourcing` |
| Material/ Goods, FFD/ Transporter | — | — |

### 15.6 Step-by-Step Flow

1. `MappedServicesPopup.load()`: in parallel `catalogOf(bucket)` → `GET
   /p2p/services?service_type=…[&classification=…]&per_page=200&sort=name`
   (cached per `serviceType|classification`; a failure is removed so the next
   open retries) and `GET /vendors/{id}/service-mappings`. The response `meta`
   (`supplier_service_type`, `supplier_classification`, `origin`) is the truth; a
   different bucket triggers a second catalogue fetch. International → `GET
   /p2p/services/master-bundle` for the currencies (INR removed). Only `active`
   rows are listed.
2. Title *Mapped Services* (wizard) / *Mapped Services — S-xxx* (list, **Map New
   Service** in the header); subtitle *"{bucket label} linked to this supplier
   with price & GST"* (international *"… with price"*). Columns — domestic: SR.
   NO · SERVICE · SERVICE CODE · HSN / SAC · PRICE (₹) · GST % · GST (₹) · TOTAL (₹)
   · ACTIONS; international: PRICE and TOTAL (₹ VALUE), no GST columns. No pager
   (5 rows, then scroll). Search *"Search service, code, HSN/SAC, price…"*.
3. **Map Service** form: Service Name (options *"{code} — {name}"*, minus mapped
   and `inactive`; drafts offered; empty *"No unmapped service in {bucket} — add
   one in Service Management."*), Service Code / HSN (auto); domestic: Price (₹),
   GST % (auto), GST Amount, Total; international: Currency (picks its master
   rate), Price ({CUR}), Exchange Rate (₹), Total, ₹ Value; Remarks (max 1000).
4. **Edit** (*"Edit Mapped Service"*): price, currency, rate, remarks; service
   locked. **Unmap**: *"Unmap this service? — {name} will no longer be mapped to
   this supplier. You can map it again later."*

### 15.7 Validations — browser

(after the first Save; toast *"Fill in the service
details"* + the first error): *Select a service* · *Enter a price greater than
0* · international *Select the supplier’s currency* · *Enter the exchange rate
(₹ per unit)* · domestic, new mapping, service with no GST % — *This service has
no GST % yet — set it in Service Management first*. No typing sanitiser and no
upper limit in the browser.

### 15.8 Validations — server

(`servicePriceRules()` + `servicePriceMessages()`, no relabelling)

```
mappings                    present|array
mappings.*.service_id       required|integer|distinct     "A service can only be mapped once per supplier."
mappings.*.origin           nullable|in:domestic,international
mappings.*.price            required|numeric|gt:0|max:9999999999.99
                            "Enter the supplier's price." · "The price must be more than 0."
                            · "The price cannot be more than 9,999,999,999.99."
mappings.*.gst_id           nullable|integer
mappings.*.currency         nullable|string|size:3|alpha  "Pick a currency (3-letter code, e.g. USD)." (size only)
mappings.*.exchange_rate    nullable|numeric|gt:0|max:99999.9999
                            "The exchange rate must be more than 0." · "The exchange rate cannot be more than 99999.9999."
mappings.*.remarks          nullable|string|max:1000
```

PATCH: the same with `sometimes|required` on price / currency / rate,
`sometimes|nullable` on `gst_id` / remarks, no `origin`; the 403 check runs
**before** validation. Business-rule 422s (`SSM::assertServes()`,
`priceFields()`, `SupplierPricing::assertFits()`): *Unknown service id: X.* ·
*Set this supplier's Supplier Type first — only a supplier whose type serves {X}
can be mapped to {CODE}.* · *A {Type} supplier cannot supply a service. Only a
supplier whose type serves {X} can be mapped to {CODE}.* · *This supplier's type
({Type}) does not serve {X} — {CODE} needs a {X} supplier.* · *This supplier is
based in India — map it as a Domestic supplier.* · *This supplier is based in
{country} — map it as an International supplier.* · *Pick the supplier's
currency — an International price is not in ₹.* · *Enter the exchange rate (₹
per {CUR}).* (no rate sent and no active master rate) · *Map a GST % to this
service first (Stage 1) — domestic suppliers use the service GST.* (service
`gst_id` empty) · *The supplier GST must be the service GST ({pct}%, gst_id
{id}).* · *The total value is too large (max ₹ 999,999,999,999.99). Check the
price and exchange rate.* PATCH / DELETE of a row not of this supplier → 404
*Service mapping not found for this supplier.*

### 15.9 API Requests

`servicePayload()`; always every active row + the new one:

```json
POST /api/vendors/31/step/services
{ "mappings": [
    { "service_id": 3, "origin": "domestic", "price": 100, "remarks": null },
    { "service_id": 8, "origin": "domestic", "price": 2500, "remarks": "Annual retainer" } ] }

POST /api/vendors/44/step/services
{ "mappings": [ { "service_id": 9, "origin": "international", "price": 250,
                  "currency": "USD", "exchange_rate": 84.2, "remarks": null } ] }

PATCH  /api/vendors/31/service-mappings/7   { "price": 120, "remarks": null }
PATCH  /api/vendors/44/service-mappings/9   { "price": 260, "currency": "USD", "exchange_rate": 85, "remarks": "…" }
DELETE /api/vendors/31/service-mappings/7
```

The browser never sends `gst_id`.

### 15.10 Backend Processing

* `storeServices()` — Section 15.13, step by step: visible services (`SSM::services($user)`, no status filter) → per row 403 check, `assertServes()`, `priceFields()` (origin = sent or the supplier's by country; international: currency = sent or `currencyFor(country)`, rate = sent or `defaultRate()`, no GST, `inr_amount = price × rate`; domestic: the service's GST %, `gst_amount`, total, `inr_amount = total`; `assertFits()`) → dropped active rows checked too → `DB::transaction`: `upsert()` = `firstOrNew(service_id, vendor_id)` + amounts + remarks + `status='active'`, `completeStageTwo()`; dropped rows → `status='inactive'` → `serviceMapsPayload()`.
* `updateServiceMapping()` — `findServiceMap()` (any status) → 403 → validate → `priceFields()` with the stored origin and sent-or-stored values → save. No `assertServes()`, no status change.
* `destroyServiceMapping()` — 403 → `status='inactive'` (idempotent) → the row + `service_suppliers_count`.

### 15.11 Database

`p2p_service_suppliers` (unique `service_id, vendor_id`):
`origin`, `currency_code`, `price`, `gst_percentage`, `gst_id`, `gst_amount`,
`total_amount`, `exchange_rate` (international), `inr_amount`, `remarks`,
`status`, `created_by` / `updated_by`. `p2p_services.step_completed`, `status`,
`updated_by` (draft service → active). Read: `vendors`, `vendor_addresses` +
country / state, `master_vendor_types`, `currencies`, `p2p_services`. The supplier
row is never written.

### 15.12 Response and UI

GET / POST: `{ data: [rows incl. inactive], summary: {
count, domestic_count, international_count, inactive_count, total_amount },
meta: { vendor_id, vendor_code, vendor_name, supplier_type,
supplier_service_type, supplier_classification, origin, country, currency } }`;
each row carries `gst_type` (`intra` / `inter` by the supplier's state code vs
`Gst::homeStateCode(branch)` — `branches.gst_state_code`, else the branch GSTIN prefix, else `27`; `none`
international) and the computed `cgst_amount` / `sgst_amount` / `igst_amount`.
Toasts: *"Service mapped — {name} is now mapped to this supplier."* · *"Service
updated — {name} has been updated for this supplier."* · *"Service unmapped —
{name} is no longer mapped to this supplier."*; errors *"Could not map / update
/ unmap the service — <first error or message, or Please try again.>"*. After a
success: form closes, search cleared, `load()`, `onChanged()` (the list recounts).
Load failure: *"Load failed — Could not load the services for this supplier."*
and *"Could not load the services. Close and open this popup to try again."*;
`servesNone`: *"This supplier’s type does not supply services, so no service can
be mapped."*


### 15.13 Code Walkthrough (function by function)

#### Loading

```
catalogOf(bucket)             ← useRef(Map) of promises, key "serviceType|classification"
   GET /p2p/services?service_type&classification&per_page=200&sort=name
   a failed promise is removed so the next open retries

in parallel:
   GET /vendors/{id}/service-mappings
        meta.supplier_service_type / supplier_classification / origin
        → serverKind (bucket + Domestic/International)  ← server truth
        → if the bucket differs from the guess, ask catalogOf() for the right one
```

`servesNone` = the server says this supplier's type maps no service → empty state,
and both add buttons (Map Service / Map New Service) are disabled.

#### Saving — `save()` (inside `MappedServicesPopup`)

```ts
if (editRow)  PATCH /vendors/{id}/service-mappings/{mapId} { price, currency?, exchange_rate?, remarks }
else          POST  /vendors/{id}/step/services {
                 mappings: [ ...rows.map(servicePayload), servicePayload(newRow) ] }
                 // REPLACE-ALL: sending only the new row would switch the others off
then: closeForm(); clear search; load(); props.onChanged?.()   // the list recounts
```

`servicePayload()` turns a row into `{ service_id, origin, price, currency?,
exchange_rate?, remarks }`. The service picker lists the bucket's catalogue
minus services already mapped and minus `status === 'inactive'` (draft services
are offered).

#### Unmap — `unmap()` (inside `MappedServicesPopup`)

Confirm dialog → `DELETE /vendors/{id}/service-mappings/{mapId}` → server sets
`status = inactive`.

**Server — `VendorController::storeServices()`:**

```
editableVendor()            forUser + hierarchicalDenial (always null for a Vendor)
validate                    mappings present|array; service_id required|integer|distinct;
                            servicePriceRules(): origin in domestic|international, price
                            gt:0 max 9999999999.99, gst_id, currency size:3 alpha,
                            exchange_rate gt:0 max 99999.9999, remarks ≤ 1000
for each row
   service visible to the user?            else 422 "Unknown service id: X."
   serviceEditDenial(user, service)        → 403 "{CODE}: {reason}"
   assertServes(vendor, service)           type ↔ bucket (vendorServiceType())
   priceFields()                           origin must equal the supplier's (by country);
                                           international: currency (default by country,
                                           not INR) + rate (default rate) → no GST,
                                           inr_amount = price × rate;
                                           domestic: the service's gst_id must exist (and
                                           match gst_id if sent) → GST amount, total;
                                           SupplierPricing::assertFits()
                                           (the CGST / SGST / IGST split is NOT stored —
                                           gstSplit() works it out on every read)
active mappings left out    each must pass serviceEditDenial too (else 403)
DB::transaction             upsert per (service, supplier) — revives an old row,
                            status 'active' —
                            completeStageTwo() (service step_completed ≥ 2,
                            draft → active, updated_by);
                            left-out active rows → status 'inactive'
                            (the supplier's own status is never changed)
return serviceMapsPayload() (the same payload as the GET)
```

### 15.14 Edge Cases and Known Gaps

* Replace-all re-checks every kept row: a changed country / type, a service that lost its `gst_id`, or a kept service the user can't edit blocks every new mapping. Kept domestic rows are re-priced at the service's current GST.
* The server accepts an `inactive` service; `completeStageTwo()` activates a draft service.
* The browser checks the service's GST **%**, the server its `gst_id`.
* The catalogue stops at 200 services per bucket (by name); PATCH works on inactive rows and skips `assertServes()`.
* The supplier's `status` never moves to `active` through services.

---

## 16. FEATURE 12 — SUPPLIER EVIDENCE VAULT

### 16.1 Overview

The vault shows the supplier's standard documents and, per Purchase Order deal,
its trade documents and agreements — with upload, send for signature, remind,
track and export.

### 16.2 Files Involved

| Layer | File · Function |
|---|---|
| Popup | `SupplierEvidenceVaultModal.tsx` → load, `reloadVault()`, `reloadSignatures()`, `ensurePoPdfs()`, `sendPoFromRow()`, `sendSelection()`, `evEffectiveStatus()`, `dealDocState()`, `DealPoSubTable`, `DealDocsSubTable` |
| Shared | `SegmentRefUploadPopup` (from `AddVendorModal.tsx`), `SalesCustomerSendForSignatureModal`, `SigningTrackerModal` |
| API | `GET /segment-uploads/supplier/{id}/vault`, `GET /clm/signature-requests`, `POST /segment-uploads/supplier/{id}`, `POST /p2p/orders/{po}/documents/…`, `POST /clm/signature-requests`, `POST /clm/signature-requests/{id}/remind` |
| Backend | `SDUC::vault()`, `buildPoDeals()`, `shapePoDoc()`, `buildSpiDocs()`, `buildVendorDeals()` |

### 16.3 Access

**Evidence Vault** on any row (no permission check); other
modules mount the same modal, and only Payment Request passes `viewOnly` (hides
Send / Send PO / Upload / bulk select; Remind, Track, View, Download and the
certificate stay). Server: `SDUC::resolveOwner()` — client match only (Section 9).

### 16.4 Step-by-Step Flow

1. Open → in parallel `GET /segment-uploads/supplier/{id}/vault` and `GET
   /clm/signature-requests?party_id={id}&model_name=Vendor&sync=1`. Header
   *SUPPLIER EVIDENCE VAULT — {code} — {company}* with chips.
2. **Standard Documents** (*ONE TIME · KYC, DD & LICENSES*): tabs Company Due
   Diligence · Owner KYC Details · Trade Licenses; cards *Total Standard
   Documents*, *Verified / Uploaded* (*Compliant*), *Pending* (*Action needed*)
   and one per category (uploaded = a row with `attachment_url` / `attachment`);
   header pills Verified / Signed / Expiring / Expired / Pending.
3. **Case to Case Documents & Agreements** (*PER DEAL · TRADE DOCS &
   AGREEMENTS*): switch **With Shipment ID Transactions** / **All Other
   Transactions (With Procurement ID)**. The two transaction cards always show
   both modes (ring = `dealSplit`: rows whose KYC, DD, TL and TD are all
   complete with `d >= t` **and `t > 0`** — so a deal with 0 required documents
   in a category never counts complete; agreements ignored); *Total Trade Documents*, *Total Agreements*, *Total Signed*,
   *Pending for Sign* (has a signature request, not signed — declined / recalled
   / expired included), *Not Sent for Signature* follow the switch.
4. Rows: with shipment — Shipment ID · Purchase Orders · Supplier · KYC · Due
   Dil. · Trade Lic. · Trade Docs · Agreements; without — Procurement ID · PO ID
   · PO Date (+ status) · Supplier · the ratios. Ratio tone: *Complete* ≥ 100 %,
   *Partial* ≥ 50 %, else *Missing*. Expand → POs (`DealPoSubTable`) → documents
   (`DealDocsSubTable`, select boxes only in the without-shipment mode). A PO
   with no documents → *"{po} has no documents — Nothing was marked necessary or
   unnecessary on this PO in Stage 04."*
5. Overviews: *All Standard Document Overview* (*"Standard Documents —
   Overview"*) and *Send Documents & Agreements for Signature* (pick a deal —
   shipment **and** procurement deals → documents, select all, *"N of M
   selected"*, *Send N for Signature* / *Resend N for Signature* when every
   ticked row already has a request). Overview row actions: **View** only on
   signed rows, **Send** (label **Resend** once `signature_request_id` exists),
   Remind, Track. Row tick tooltips: *Select for bulk send* / *Already signed* /
   *Already out for signature* / *Available once the document is saved against
   this deal*; the disabled bulk button's tooltip: *One of the ticked rows is not
   saved against this deal yet* / *One envelope carries one purchase order — tick
   just the one* (`canBulk`).

A global supplier (`client_id` NULL) gets a 404 from `SDUC::resolveOwner()`;
the vault load's `.catch` swallows it and the modal opens **empty** with no
message.

### 16.5 Upload / re-upload (Standard rows)

`SegmentRefUploadPopup` (Section 9 checks),
then the vault's own filter `/\.(pdf|jpe?g|png)$/i`: *"Unsupported file type —
Only PDF, JPG or PNG files are allowed. Word / Excel files are not supported."*
Same `POST /segment-uploads/supplier/{id}` payload and server logic as Section 9.
Success *"Document uploaded — {file} has been attached."*; failure *"Upload
failed — <message>"* or *"The file could not be uploaded. Please try again."*
Tab rows then call `reloadVault()`; the overview uses `res.data.vault`.

### 16.6 Statuses

server: bucket rows `Verified` (upload exists) / `Pending`; PO
documents (`shapePoDoc()`) from `clm_signature_requests.status`: completed →
`Signed`, inprogress → `Pending`, declined / recalled / expired → same. With
**no** request, `shapePoDoc()` falls back to the PO document's own `status`:
`sent` → `Pending`, `signed` / `declined` / `recalled` / `expired` → the same
names, anything else → `Pending`; `sig_state` uses the same fallback, so a row
can read **Sent** in `DealDocsSubTable` without any CLM request. Browser: `evEffectiveStatus()` → `Expired` when the expiry is before
today (Standard tables, overviews, pills); `DealDocsSubTable` uses
`dealDocState()` (`Signed` / `Sent` / `Declined` / `Recalled` / `Verified` /
`Pending`). `VaultDateBadge`: red *"Expired N day(s) ago"*, amber within 30 days
*"Expires in N day(s)"*.

### 16.7 Where the deals come from — `SDUC::buildPoDeals()`

read
`p2p_purchase_orders` (client, supplier, not deleted, newest first:
`code`, `po_date`, `shipment_order_id`, `status`, `procurement_request_code`,
`grand_total`, `currency_code`), `shipment_orders.shipment_code`,
`proforma_invoices.customer_name`, `p2p_purchase_order_documents` (not deleted,
`needed='yes'`; split into agreements / trade docs by "agreement" in sub / kind /
name), `clm_signature_requests.status`, and the SPI files (`buildSpiDocs()`,
sent as `spi_docs`, not shown). POs with a shipment code are grouped per
shipment; the rest are one row each. No PO → both arrays empty: *"No purchase
orders against a shipment for this supplier yet."* / *"No other purchase orders
for this supplier yet."* `buildVendorDeals()` (procurement-based) still runs for
`vendor_deal_ratios` only.

### 16.8 Send for signature

1. `ensurePoPdfs()`: PO rows with no `attachment_url` → `POST
   /p2p/orders/{po}/documents/{doc}/generate` (writes the PDF to
   `p2p/po-documents/{po}/…` and updates the PO document). Error *"Could not
   prepare the purchase order — <message>"* or *"Its PDF could not be generated.
   Try again in a moment."*
2. **PO only** (`sendPoFromRow()`, or a PO-only selection) →
   `SalesCustomerSendForSignatureModal` with `rawPdfContext` (preview `GET
   /p2p/orders/{po}/documents/{doc}/download`) → `POST
   /p2p/orders/{po}/documents/sign` `{ document_ids, signers[{name, email, role,
   order}], is_sequential, expiry_days, notes, document_settings }`. Refusals:
   *Submit the PO before sending documents for signature.* · *Some documents were
   not found on this PO.* · *Attach a file first: …* · *Already sent or signed:
   …* · *No valid email for this supplier. Set a primary contact email on the
   supplier first.* · 502 *Could not send for signature: …*. Writes
   `clm_signature_requests` (`document_type='p2p_po_document'`, `model_name='Vendor'`,
   `party_id`, `trade_doc_ids` = PO document ids) and the PO documents
   (`status='sent'`, `sent_at`, `signature_request_id`).
3. **Library rows** (+ at most one PO) → the CLM modal → `POST
   /clm/signature-requests` (`trade_doc_ids` / `agreement_ids`,
   `p2p_po_document_id`, `party_id`, `model_name:'Vendor'`, signers,
   `document_settings`) → then `POST /p2p/orders/{po}/documents/mark-sent`
   (errors swallowed). `document_type` is `trade_doc` when any trade document is
   in the envelope, else `agreement`. Refusals include *No accessible documents in
   the selection.* · *The purchase order PDF is not ready yet. Open Stage 04, wait
   for it to generate, then send again.* · 503 *Zoho Sign is not configured…*.
4. Success *"Sent for signature — N document(s) emailed to the signer."* →
   `reloadSignatures()` + `reloadVault()`. The overview's bulk button refuses a
   second PO in one envelope (tooltip *"One envelope carries one purchase order —
   tick just the one"*).

### 16.9 Remind / track / certificate

`POST /clm/signature-requests/{id}/remind`
(*"Reminder sent — The signer has been reminded to sign this document."*; server
400 *Reminder cannot be sent. Current status is '{state}'.*, 409 when the Zoho
request no longer exists, 500 *Failed to send reminder: …*; writes
`reminder_count`, `last_reminder_sent_at`). Tracker: `SigningTrackerModal` → `GET
/clm/signature-requests/{id}` (+ `/view-file/0`, `/certificate`,
`/declined-file`). The certificate link exists only for completed requests (never
for PO rows). Statuses re-sync (`sync=1`) on open and on window `focus` /
`visibilitychange`.

### 16.10 Export All

ZIP in the browser (`jszip`): `Standard/{Company Due
Diligence, Owner KYC Details, Trade Licenses}`, `CTC/With Shipment
ID/{shipment}`, `CTC/Without Shipment ID/{po}`; file `{code} {company}.zip`.
*"Nothing to export — There are no uploaded documents in this vault yet."* ·
*"Exported — N file(s) zipped · M had no attachment"* · *"Export failed — Could
not build the ZIP. Please try again."*

### 16.11 Close

`onClose` → `setVaultTarget(null)` → `refresh({ silent: true,
keepKindCounts: true })`, so Compliant Status is current.


### 16.12 Code Walkthrough (function by function)

```
open → GET /segment-uploads/supplier/{id}/vault
  ├─ Standard group  : company_dd[], owner_kyc[], trade_licenses[]  + counts
  └─ Case to Case    : vendor_with_shipment[] (shipments → pos[]) /
                       vendor_without_shipment[] (one row per PO)
                       each with docs[], agreements[], ratios
     GET /clm/signature-requests?party_id&model_name=Vendor&sync=1   (statuses)

upload / re-upload → POST /segment-uploads/supplier/{id}  → response carries a fresh vault
                     (used by the overview's submitOvUpload(); a tab row's onPick()
                      ignores it and calls reloadVault() — a second request)
send   sendPoFromRow() / sendSelection():
         PO rows → ensurePoPdfs(): only rows with no attachment_url →
                   POST /p2p/orders/{po}/documents/{doc}/generate
         PO only → SalesCustomerSendForSignatureModal with rawPdfContext
                   (preview /p2p/orders/{po}/documents/{doc}/download) and
                   sendUrl /p2p/orders/{po}/documents/sign
         library rows (+ at most one PO bundled) → SalesCustomerSendForSignatureModal
                   (CLM signing, trade or agreement envelope)
       one envelope may mix trade documents, agreements and one PO
remind → POST /clm/signature-requests/{id}/remind, then reloadSignatures()
status re-sync → on open, and on window 'focus' / document 'visibilitychange'
                 (when visible) → reloadSignatures() (sync=1)
export all → ZIP built in the browser
close → onClose()  → Vendors refresh({ silent: true, keepKindCounts: true })
```

Dark-mode hooks: the main document status pill is `spev-status` with
`data-status`; tone pills (Mandatory / Optional, deal status, PO status) carry
`className="spev-tone" data-tone="ok|warn|bad|muted"`, and the ratio cells carry
`data-tone`. The CSS restyles the inline colours through these attributes.
`progress(split, whole)` builds the `SevStat` summary-card ring props; the
section header's Complete / Partial / Pending pills are built inline (`spill`).

**Statuses.** Standard bucket rows come from the server as `Verified` (a file
is uploaded) or `Pending`. PO documents (`shapePoDoc()`) and supplier
agreements (`overlaySupplierDocs()`) come as `Signed`, `Pending`, `Declined`,
`Recalled` or `Expired`, from their signature request. On top of that the
browser's `evEffectiveStatus()` turns a row whose expiry date is past into
`Expired` — in the Standard tables, both overviews and the header pills. The
per-PO document table (`DealDocsSubTable`) uses `dealDocState()` instead
(`Signed` / `Sent` / `Declined` / `Recalled` / `Verified` / `Pending`, no
`Expired`), so the same row can read differently there and in the overview.
The amber "expiring" tone is only a date colour.

**Server — `SDUC::vault()`:** the deal rows come from `buildPoDeals()` — the
supplier's purchase orders, each PO's `p2p_purchase_order_documents` with
`needed = 'yes'` (status from `clm_signature_requests` via `shapePoDoc()`) and
its Supplier Invoice files (`buildSpiDocs()`, sent as `spi_docs` but not shown).
POs with a shipment are grouped per shipment; the rest are one row each. No PO
→ two empty arrays (the screen shows *"No purchase orders against a shipment
for this supplier yet."* / *"No other purchase orders for this supplier
yet."*). `buildVendorDeals()` (procurement-based) still runs, but only for
`vendor_deal_ratios` (KYC / DD / TL / TD ratios merged into each row's
`ratios`) and the `?ring=1` payload.

### 16.13 Edge Cases and Known Gaps

* No bulk send in the With-Shipment **tab view** (`DealPoSubTable` passes no `onBulkSend`); the overview does offer it for shipment deals. `sendSelection()` uses only the first PO of a mixed selection.
* The vault is empty, with no message, for a global supplier (404 swallowed).
* The transaction-card ring never counts a deal complete when a category has 0 required documents.
* A PO row's View opens the unsigned PDF; PO rows never get a certificate.
* Agreements sent in the same envelope as a trade document are stored as `document_type='trade_doc'`, which `SupplierCompliance` does not read as a signed agreement (Section 17).
* The signature overlay matches by library id, not per PO — a request for a library document on PO A can colour the same document on PO B; a PO-module request id can collide with a library id. (Needs a runtime check.)
* `markSent` for a bundled PO probably fails (*"Purchase Order" is not part of that signature request.*) and the error is swallowed. (Needs a runtime check.)
* Esc closes the whole vault even with an inner popup open.

---

## 17. FEATURE 13 — COMPLIANCE STATUS

### 17.1 Overview

*Compliant* / *Non Compliant* is computed on every list request from the
segment rules, the uploads, their expiry dates and (once there is a PO) the
signed agreements. Nothing is stored.

### 17.2 Files Involved

| Layer | File · Function |
|---|---|
| Backend | `SupplierCompliance::statuses()`, `evaluate()`, `agreementLibrary()`, `signedAgreements()` |
| Caller | `VC::index()` (facets and each row's `compliance_status`) |
| Screen | `Vendors.tsx` Compliant Status column and filter |

### 17.3 Access and Timing

called by `VC::index()` for every scoped supplier id on every
list request; nothing is stored. No client id (e.g. super admin) → nothing is
computed and every row reads *Compliant*.

### 17.4 Logic (fixed number of queries, then PHP)

1. Suppliers with their segments (or the single `segment_id`) and primary
   country. **Origin**: `trim(country name) === 'India'` → domestic; anything
   else, **including no country**, → international.
2. `clm_segment_rules` of the client, by `segment_id`. Per segment: the rule
   whose `document_type` equals the origin, **else the first rule** of that
   segment.
3. Mandatory codes = every `M` in `doc_selections` for `kyc`, `dd`, `tl`, and
   `td` (`td` only once the supplier has a PO).
4. `segment_doc_uploads` of the suppliers (`category::doc_code` → `expiry_date`).
5. "Has a PO" = any non-deleted `p2p_purchase_orders` row (drafts count).
6. Agreements: `clm_agreement_library` of the client with `agr_status='Active'`,
   whose `regulatory` equals the segment's `regulatory_status`, whose `segment`
   CSV contains the segment's name or code (case-insensitive), and whose `party`
   is empty or contains a token starting with "supplier".
7. Signed: `clm_signature_requests` with `model_name='Vendor'`,
   `document_type='agreement'`, `status='completed'` → the library ids in
   `trade_doc_ids` (or `trade_doc_id`) with the request's `expiry_date`.

### 17.5 Verdict (`evaluate()`)

*Non Compliant* when a mandatory code has no upload
or its upload expired; or **any** upload (optional too) expired; or, once there
is a PO, an applicable agreement is not signed or its signature expired.
Otherwise *Compliant*. A supplier whose segments have **no** `clm_segment_rules`
only has no mandatory codes — it is still *Non Compliant* for any expired upload,
or (with a PO) for an unsigned agreement, because the agreements come from
`agreementLibrary()` (regulatory status + segment name / code), not from the
rules.

### 17.6 Edge Cases and Known Gaps

no-country suppliers are judged international (the
list shows them as Domestic); draft POs count; agreements signed inside a mixed
trade-document envelope are not counted.

---

## 18. FEATURE 14 — CONVERT TO SUPPLIER (FROM THE SOURCING TRACKER)

### 18.1 Overview

A New Supplier from the Sourcing Tracker is turned into a full supplier through
this wizard. The **link** happens at the Contact Person Details save; the final
`POST …/convert` confirms and copies the business card.

### 18.2 Files Involved

| Layer | File · Function |
|---|---|
| Sourcing page | `SourcingTracker.tsx` → `startConvert()`, `finishConvert()`, `closeConvert()` |
| Wizard | `AddVendorModal.tsx` (props `prefill`, `convertSupplierId`, `canMapProducts={false}`) |
| API | `GET /p2p/new-suppliers/{id}/convert`, `POST /vendors/step/identity`, `POST /vendors/{id}/step/contacts` + `convert_supplier_id`, `POST /p2p/new-suppliers/{id}/convert` |
| Backend | `SourcingController::convertPrefill()`, `VC::storeContacts()`, `SourcingController::convertSupplier()` → `copyBusinessCard()` |

### 18.3 Access

* Frontend: the **Convert to Supplier** button on a Mapped Suppliers card when
  `canConvert` (a `new` row whose New Supplier has no `converted_vendor_id`).
  In the Sourcing Tracker it is **not** gated by creator / assignee; in Bulk
  Sourcing it is (`canMap`).
* Server: `convertPrefill()` / `convertSupplier()` — only
  `P2pSupplier::where('client_id', …)->findOrFail()` (404 *No query results for
  model [App\Models\P2p\Supplier] {id}*); no permission check.
  `storeContacts()` — Section 8.

### 18.4 Step-by-Step Flow

Section 18.11: loader *"Opening Add Supplier — loading {name}'s
details…"* → prefill → the wizard (no chooser, `canMapProducts={false}`) → Stage
1 identity → **Contact Person Details save = the link** → Stage 2 → Save
Supplier → `finishConvert()` → `POST /p2p/new-suppliers/{id}/convert`.

### 18.5 What the wizard receives

`scope` (`international` if `origin ===
'international'`, else `domestic`), `prefill { origin, identity, address }`,
`convertSupplierId`. The mount effect copies (when non-empty): `company_name`,
`legal_name`, `segment_id` (as the only segment), `gst_applicable` (`No` for
international), `address_line`, `country_id`, `state_id`, `state_code`, `city`,
`google_location`, `contact_name`, `contact_no`, `email`. **Not** filled: Supplier
Type, Risk Level, Supplier Behaviour, website, GST / TIN number, designation,
attachment (the business card is never shown in the form).

### 18.6 Validations

the normal Stage 1 / contact rules; a prefilled segment whose
rules are **only for the other origin** blocks Save (*"… has no Domestic rule
…"*); a prefilled segment with **no rule at all** is not flagged (`t` undefined
in `saveIdentity()`) and saves. The prefill's `segment_id` is matched by
**name** in the read scope; if it resolves to a global segment (`client_id`
NULL), `normalizeSegmentIds()` drops it and the supplier is saved with **no
segment**. Server:
`storeContacts()` → *This New Supplier cannot be converted into this supplier.*
(422); `convertSupplier()`: `vendor_id required|integer` (*Save the supplier in
the Supplier Master first.*), not in the client → *Unknown supplier in the
Supplier Master.*, converted into another supplier → 422 `{ status: false,
message: "“{name}” is already converted to another supplier in the Supplier
Master." }`.

### 18.7 API Requests (in order)

```
GET  /api/p2p/new-suppliers/4/convert
POST /api/vendors/step/identity            (Section 7; no id → creates S-NNN, draft)
POST /api/vendors/31/step/contacts         (Section 8; multipart, _method=PUT, convert_supplier_id=4)
…    Stage 2 calls (no convert field)
POST /api/p2p/new-suppliers/4/convert      { "vendor_id": 31 }
```

### 18.8 Backend Processing

* `storeContacts()` with `convert_supplier_id`: after the contact transaction, if
  the New Supplier is not already linked to this supplier, a second
  `DB::transaction`: every `p2p_sourcing_product_suppliers` row with
  `source='new'` and `supplier_id` = the New Supplier → if the same sourcing
  product already has a `source='master'` row for this supplier, the new row is
  **soft-deleted** (its quote is dropped, the Master row's price kept); else
  `source='master'`, `supplier_id` = vendor id, `name` = company name. Then
  `p2p_suppliers.converted_vendor_id`, `converted_at`, `converted_by`.
* `convertSupplier()`: finds the vendor by `client_id` (not by branch) → the same
  move (normally 0 rows) → re-stamps `converted_*` → `copyBusinessCard()`: if the
  primary contact has no attachment and the New Supplier's `card_path` exists,
  copy it to `vendor_documents/{vendorId}/contact-{8 hex}__{name}.{ext}` and set
  `vendor_addresses.attachment_path`.

### 18.9 Database

written: `vendors`, `vendor_segments`, `vendor_addresses`
(Section 7–Section 8), `p2p_sourcing_product_suppliers` (`source`, `supplier_id`, `name`,
or `deleted_at`), `p2p_suppliers` (`converted_vendor_id`, `converted_at`,
`converted_by`), the copied card file.

### 18.10 Response and UI

prefill `{ status, data: { supplier_id, origin,
converted, converted_vendor_id, sourcing_count, identity{…}, address{…},
business_card } }`; final `{ status, data: { supplier_id, vendor_id,
vendor_code, vendor_name, mappings_moved, mappings_merged,
business_card_copied, message: "{New Supplier name} is now in the Supplier
Master as S-031." } }` → *"Converted to Supplier — <message>"*, the card shows
**Converted** at once, report and list reload. Failures: Section 18.11.


### 18.11 Code Walkthrough (function by function)

```
SourcingTracker.tsx  startConvert(supplierId, name)
  ├─ ConvertOpening (FullPageLoader "Opening Add Supplier — loading <name>'s details…")
  ├─ Promise.all( loadAddVendorModal(),
  │               GET /p2p/new-suppliers/{id}/convert )      ← prefill
  │     converted already? → toast.info "<name> is already in the Supplier Master" /
  │                          "Its mappings show it as Master.", reportRefresh++, reopen report
  │     error              → "Couldn’t open Convert to Supplier" / server message or
  │                          "Please try again.", reopen report
  └─ <AddVendorModal scope prefill convertSupplierId canMapProducts={false}
                     onClose={closeConvert} onSubmit={finishConvert}>
        saveIdentity()   → POST /vendors/step/identity            (creates the supplier, draft)
        saveContacts()   → POST /vendors/{id}/step/contacts + convert_supplier_id
                             VendorController::storeContacts() LINKS here:
                             sourcing rows new → master, converted_vendor_id set
        … Stage 2 …
        finishSupplier() → onSubmit → finishConvert(payload)
             no payload.vendorId → toast "Supplier saved, not linked" / "<name> was saved, but
                                   its id did not come back. Open Convert to Supplier again
                                   to link it."
             POST /p2p/new-suppliers/{id}/convert { vendor_id }
                SourcingController::convertSupplier():
                  vendor looked up by client_id (not forUser / branch)
                  re-runs the move (normally 0 rows), re-stamps converted_*,
                  copyBusinessCard() if the primary contact has no attachment
             ok    → converted set (button hidden at once), toast "Converted to Supplier",
                     report + list reload
             error → toast "Supplier saved, not linked" / server message or "The supplier
                     was saved but could not be linked. Please try again." — the report
                     reopens WITHOUT a refresh or list reload
  closeConvert() (Cancel) → the report reopens (no reload; the report remounts and
                     refetches). If saveContacts() already ran, the New Supplier is
                     linked and its card shows "Converted".
```

Why the link moved into `storeContacts()` (commit `bf7dad2ed`): it used to live
only in the final `convertSupplier()` POST, so abandoning the form mid-way left
an orphan supplier, the New Supplier unlinked, the Convert button still showing,
and every retry created another supplier. `convert_supplier_id` already arrived
at the contacts step, so the link is made there. This fixes the problem only
for a form abandoned **after** Contact Person Details: the supplier itself is
still created by `storeIdentity()` at Stage 1, so cancelling between Stage 1
and the contacts step leaves an unlinked `draft` S-NNN, the Convert button stays,
and a retry creates another supplier. The same commit made
`convertSupplier()` look the supplier up by client instead of `forUser()`
(branch scope), which had rejected a supplier saved in another branch of the
same client and left the link silently missing.

Responses: the prefill is `{status, data:{supplier_id, origin, converted,
converted_vendor_id, sourcing_count, identity{…}, address{…},
business_card}}`; the final POST returns `{status, data:{supplier_id,
vendor_id, vendor_code, vendor_name, mappings_moved, mappings_merged,
business_card_copied, message}}` (`mappings_*` normally 0 now). Its errors:
422 *Save the supplier in the Supplier Master first.* / *Unknown supplier in
the Supplier Master.* / *"X" is already converted to another supplier…*
(`{status:false, message}`), 404 for an unknown New Supplier.

Bulk Sourcing's `SourcingReportModal` runs the same flow (prefill → wizard with
`convertSupplierId` → `POST …/convert`) with its own toasts (*"<name> added to
Supplier Master"* / *"Supplier saved, but linking failed"*). Differences: its
Convert button is offered only to the target's creator / assignee (`canMap`),
there is no opening loader, the **whole** prefill response is passed as
`prefill`, and a missing `vendorId` gives the same *"Supplier saved, but linking
failed"* toast. In the Sourcing Tracker the Convert button is **not** gated by
`canMap` — anyone who can open the report sees it — and neither convert endpoint
checks a permission (only that the New Supplier is in the user's client).

The Mapped Suppliers card reads `canConvert` (a `new` row whose New Supplier has
no `converted_vendor_id`) and `converted` (a `master` row whose supplier some
New Supplier was converted into) from `SourcingController::mappedSuppliers()`;
`converted` shows the **Converted** badge where the button was.

### 18.12 Edge Cases and Known Gaps

no permission on the convert endpoints; Cancel
after the contacts step leaves a linked, unfinished `draft` supplier (by design);
Cancel **between Stage 1 and the contacts step** leaves an **unlinked** `draft`
S-NNN (created by `storeIdentity()`), Convert stays visible, and a retry creates
another supplier; a prefilled global segment is dropped (no segment saved);
the "not linked" failure toast is misleading (the link exists — only the card
copy and re-stamp are missing) and the report is not refreshed; a domestic New
Supplier whose country did not resolve loses its prefilled state (the
India-auto-select effect clears it); the email uniqueness check spans every
client.

---

## 19. FEATURE 15 — CONTACT PERSONS AND SEGMENTS POPUPS

### 19.1 Overview

Two small read-only popups on the list show all contact persons and all
segments of a row. They use the data already loaded with the list.

### 19.2 Files Involved

| Layer | File · Function |
|---|---|
| Page | `Vendors.tsx` → Contact Persons popup, Segments popover |
| API | none (data from the `GET /vendors` row) |

### 19.3 Access

anyone on the list. No server call — the data is already in
the `GET /vendors` row (`addresses[]`, `segments[]`).

### 19.4 Contact Persons

the *"+{N-1}"* button shows when a row has more than one
named contact (tooltip *"View all {N} contacts"*). Title *"Contact Persons"*,
sub-line *"{company} — {N} contact(s)"*. One row per contact: initial, name (cut
at 30 with a tooltip), pill (*Primary*, the designation, or *Contact*; cut at
18), phone, email. Closes on × or a backdrop click (not Esc); page scroll is
locked on `html` and `body`.

### 19.5 Segments

*"+{N-1}"* when there is more than one segment (tooltip *"View
{N-1} more"*). A 260 px popover next to the button (flips up when there is no
room), title *"Segments ({N})"*, each segment with its regulatory badge (list
max-height 148 px). Closes on a click outside, a window resize, or a scroll
outside it.

### 19.6 Edge Cases and Known Gaps

contacts without a name are left out; the popups show what the
list row loaded, so a change made in another tab appears only after a refresh.

---

## 20. DESIGN PATTERNS USED

| Pattern | Where | Why |
|---|---|---|
| **Replace-all saves** | `step/products`, `step/services`, `step/kyc` | The client sends the whole list; the server makes the table match it. Always send every row |
| **Names, not ids** | `vendor_behaviour` (and `vendor_type` as a fallback) | The server resolves the name to the tenant's master row and creates it if missing. Supplier Behaviour's options come from its master, by name (Section 7); Supplier Type's options are the fixed tree, sent by id |
| **Server truth over the list row** | Mapped Services `meta` | The list may be stale; the popup asks the server what the supplier is |
| **`savedVendorType`** | Wizard | Mapping follows what is saved, never an unsaved dropdown change |
| **Request tokens** | `reqRef` in `Vendors.tsx` | A slow old response can't overwrite a newer one |
| **Lazy + warm** | Every modal; `warmVendorWizard` on hover | Small first load, instant open |
| **Scoped CSS** | `:is(body:has(.smc-root.sup-list), body:has(.sct-page), body:has(.svm-page))`, `.spev` | Supplier styles never reach Customer, Consignee, Product or HRMS |
| **Immediate saves for child rows** | Contacts, banks, GST, uploads | Each popup saves on its own; the step buttons only save the step |

---

## 21. TROUBLESHOOTING GUIDE

### 21.1 List, Filters and Access

| Symptom | Look in |
|---|---|
| A count on the Domestic / International tab is wrong | `VendorController::index()` — scope SQL and facets |
| A type tab misses a supplier | `Vendors.tsx` `typeKind()`, `KIND_FETCH_CAP` |
| A dropdown shows old masters | `vendorBundleCache.ts` (5 min) and `MasterBundleCache` on the server |
| A user without `p2p.supplier` opens `/suppliers` | `routeAccess.ts canAccessPath()` returns `isBiz` for that path |

### 21.2 Layout and Styling

| Symptom | Look in |
|---|---|
| The page scrolls / the table is too tall | `Vendors.tsx` `recompute()`; the scroller's height and max-height |
| An empty band under the table, or the table runs past the footer | `recompute()` triggers: the 340 ms strip timer, the `ResizeObserver` on the blocks above the table, `document.fonts.ready` |
| Rows flicker or lag while scrolling | The `is-scrolling` listener and its CSS rule |
| A Supplier style changed a Customer / Consignee screen | A rule in `supplier-evidence-vault.css` or `add-vendor-modal.css` missing `.spev` / the page scope |

### 21.3 Wizard — Identity, Contacts and Edit

| Symptom | Look in |
|---|---|
| A segment is greyed out in the form | No Document Control Panel rule for that segment and origin |
| Map Product / Service is disabled | `typeUnsaved`, `savedVendorType`, `serviceBucketOf()` in `AddVendorModal.tsx` |
| "Supplier Type can no longer be changed" | `SegmentGuard::vendorCommittedDocument()` — a committed PO or Supplier Invoice |
| "Cannot remove segment" | `storeIdentity()` segment guards; `SegmentGuard::vendorLockSources()` |
| GSTIN with the wrong state is accepted | Known bug — `storeIdentity()` reads `$data['address']` after unsetting it (still present) |
| The Stage 1 address went blank after a contacts save | `VC::storeContacts()` rebuilds the primary row only from `primary_address[...]` |
| Only two fields have a quick-add "+" | Only Supplier Segment and Product Name pass `addNew` to `Field`; the generic `quickAdd` popup is dead code (`setQuickAdd` is only ever called with `null`) — including its `vendor_behaviour` case |
| A segment picked in the form is missing after save | `VendorController::normalizeSegmentIds()` keeps only the client's own segments (global ones are dropped) |
| Supplier Behaviour shows different options per tenant / an unexpected name | `hydrate()` (`behaviourOpts` from `vendor_behaviour` of the master bundle), `supplierBehaviourOptions`, `SUPPLIER_BEHAVIOUR_OPTS` fallback — Section 7 |
| A new master behaviour row appears after a save | `VC::storeIdentity()` `VendorBehaviour::firstOrCreate()` (by client + exact name) |
| A segment's DOM / INT badge is missing | `hooks/useRuledSegments.ts` (`GET /clm/segment-rules`) |

### 21.4 Stage 2 Documents and Compliance

| Symptom | Look in |
|---|---|
| Compliant / Non Compliant looks wrong | `SupplierCompliance::statuses()`; the segment rules in CLM |
| A required document is missing from Stage 2 | `clm_segment_rules.doc_selections` for that segment / document type |
| A supplier passed Stage 2 with mandatory files missing | `saveKyc()` checks only the legacy DD rows |
| A .webp upload is refused although the popup offers it | `validateVendorUpload` in `AddVendorModal.tsx`; SDUC upload rules |
| An older supplier's KYC tab shows a different table | Legacy rows exist (`ddRows` / `ownerRows` / `licenseRows`), so the old table is shown instead of `SupplierSegmentRefTable` |
| Stage 2 lists documents the vault doesn't (or the reverse) | `ClmSegmentRuleController::forSegment()` (segment code + exact document type) vs `SegmentDocScope` (segment id + fallback) |
| A signed agreement still leaves the supplier Non Compliant | It was signed in a mixed envelope (`document_type='trade_doc'`); `SupplierCompliance::signedAgreements()` reads `agreement` only |

### 21.5 Product and Service Mapping

| Symptom | Look in |
|---|---|
| Mapping one service removed the others | The client sent a partial list to `step/services` (replace-all) |
| A service supplier stays inactive | Only `VC::storeProducts()` and `ProductController::storeVendors()` set `active`; `storeServices()` never touches the supplier's status |
| An FFD / untyped supplier has (more) mapped products | `MappedProductsViewPopup` and `VC::storeProducts()` don't check the Supplier Type |
| A mapping's GST % is 0 for a taxed product | `VC::storeProducts()` stores the client's GST values as sent (no recompute) |
| An inactive product became active again | `VC::storeProducts()` sets every listed product `active` on every save |
| Product-side origin / currency on a mapping disappeared | `VendorController::storeProducts()` re-creates the rows without those columns |
| "These products have no GST rate and cannot be mapped…" on a product the user did not touch | `VC::storeProducts()` CS-2327 check runs over the **whole** replace-all list — an already-mapped product has no `gst_id` |
| "GST required — … has no GST rate" in the wizard | `AddVendorModal.tsx saveMapDraft()` (the product's GST % is empty in `productOpts`) |
| Update Supplier fails with a product message | `finishSupplier()` → `saveProducts()` re-posts every mapping; see the row above |
| Mapped Products list popup emptied all mappings | The mappings failed to load and a save was made anyway (replace-all) — `MappedProductsViewPopup` `saveMapping()` |

### 21.6 Evidence Vault

| Symptom | Look in |
|---|---|
| The vault opens empty for a supplier | Global supplier (`client_id` NULL) → `SDUC::resolveOwner()` 404, swallowed by the vault load |
| The Case to Case tab is empty for a supplier with deals | `SDUC::buildPoDeals()` — rows exist only for the supplier's Purchase Orders; documents only when marked necessary (`needed='yes'`) in the PO's Stage 04 |

### 21.7 Convert to Supplier

| Symptom | Look in |
|---|---|
| Convert to Supplier didn't link | `VendorController::storeContacts()` (the link is made there, from `convert_supplier_id`); then `SourcingController::convertSupplier()` |
| A converted New Supplier still shows Convert, or no Converted badge | `SourcingController::mappedSuppliers()` / `mappedRow()` (`canConvert`, `converted`); `MappedSuppliers.tsx` |
| An unlinked draft supplier after Convert was cancelled | `storeIdentity()` created it at Stage 1; the link is made only at `storeContacts()` |

---

## 22. COMPLETE FLOW SUMMARY

### 22.1 End to End

```
Open Supplier Management (/suppliers)
   → Add Supplier → choose Domestic / International
   → Stage 1  Identification & Address  → POST /vendors/step/identity   (S-NNN created, draft)
   → Stage 1  Contact Person Details    → POST /vendors/{id}/step/contacts
   → Stage 2  DD / Owner KYC / Trade Licence uploads → POST /segment-uploads/supplier/{id}
              Bank Details   → POST /vendors/{id}/bank-accounts
              GST Scrutiny   → POST /vendors/{id}/gst-scrutiny   (domestic)
              Save & Next    → POST /vendors/{id}/step/kyc        (draft → inactive)
   → Save Supplier → bank / GST checks → step/kyc (+ step/products when products are mapped)
   → Map Product / Service
        ├─ Material/ Goods → POST /vendors/{id}/step/products   (supplier → active)
        └─ Service types   → POST /vendors/{id}/step/services   (service → active)
   → Evidence Vault: documents, PO deals, send for signature
   → Compliance shown on the list (computed every time)
```

### 22.2 One Save, Layer by Layer (Stage 1)

```
AddVendorModal.saveIdentity()   (browser checks → flagErrors)
  → POST /vendors/step/identity
  → VC::storeIdentity()  (validate → type / behaviour names → type lock → segments → TIN / GST
                          → GST uniqueness → segment guards → transaction)
  → INSERT / UPDATE vendors ; SYNC vendor_segments ; UPSERT primary vendor_addresses
  → { data: shape() }
  → vendorId, vendorCode, savedVendorType ; toast "Identity saved" ; Contact Person Details tab
```

---

## END OF DOCUMENT

| Item | Covered |
|---|---|
| File structure (backend, frontend, shared) | Section 2 |
| Every API route and access check | Section 3 |
| Conventions | Section 4 |
| 15 features: overview, files, access, steps, validation, API, backend, database, response, code walkthrough, gaps | Sections 5–19 |
| Patterns | Section 20 |
| Troubleshooting (grouped) | Section 21 |
| Complete flow | Section 22 |

**Related documents:** Supplier Management Functional Documentation · Technical
Documentation · API Documentation.
