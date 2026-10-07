# PRODUCT MODULE — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · P2P → Master Management → Product Management

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-10-06 | System | Initial technical documentation |
| 1.1 | 2026-10-07 | System | Added dropdown conditions, pagination, product card |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
The Product module is the P2P **product master** — a branch-shared catalogue of tradeable items. A product carries classification lookups, images/attachment, selling price + GST, legacy quality/inventory fields, QC records, and a list of **supplier mappings** (`product_vendor_maps`) that is mirrored onto the vendor side (`vendor_product_mappings`). It is built step-wise (Core → Sales → Quality → Vendors; the current UI uses Core → Sales → Vendors) and is consumed by the Sales Matrix (Stage 3 product directory / vendor-count popup), Purchase Orders, Proforma Invoices, Supplier Purchase Invoices, P2P Bulk Sourcing and Zoho Books item sync.

### 1.2 High-Level Architecture Diagram

```
┌───────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                 │
│  Products.tsx (server-paged list, tabs, filter drawer, delete)         │
│  AddProductModal.tsx (Core / Sales tabs, Map GST, Map Supplier popups) │
│  ProductView.tsx (/products/:id detail + QC segment uploads)           │
│  productBundleCache.ts (sessionStorage master-bundle cache, 5 min)     │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │ auth JSON (multipart for step/core)
                                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│                        APPLICATION LAYER (Laravel 12)                  │
│  ProductController                                                     │
│    applyScope (MasterVisibility) · editDenial/isBranchMember           │
│    departmentHiddenGroups/maskProductArray (Purchase vs Sales wall)    │
│    nextProductCode (P-NNN per branch) · gstChangeDenial · usage        │
│  SegmentDocUploadController (QC docs, delegated from show)             │
│  ZohoBooksService::findOrCreateItemId (caches products.zoho_item_id)   │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │
                                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│                          DATA LAYER (PostgreSQL)                       │
│  products (soft deletes) ─┬─ product_qc_records                       │
│                           ├─ product_vendor_maps ── vendor_id → vendors│
│                           └─ vendor_product_mappings (vendor mirror)   │
│  read by: lead_products · purchase_order_items · proforma_invoice_items│
│           · supplier_purchase_invoice_items · p2p_sourcing_products    │
└───────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure
```
app/Http/Controllers/Api/ProductController.php   # ~1572 lines — list, steps, maps, usage, bundle
app/Models/Product.php                           # master record + URL accessors (~162 lines)
app/Models/ProductQcRecord.php                   # QC rows (+ attachment_url)
app/Models/ProductVendorMap.php                  # supplier mapping rows
app/Support/MasterVisibility.php                 # read scope + hierarchicalDenial
database/migrations/
  2026_05_19_000020_create_products_table.php   (+ ALTERs listed in §3)
  2026_05_19_000021_create_product_qc_records_table.php
  2026_05_19_000022_create_product_vendor_maps_table.php
resources/js/pages/p2p/p2p-master-management/product-management/
  Products.tsx · AddProductModal.tsx · ProductView.tsx · productBundleCache.ts
```

---

## 2. TECHNOLOGY STACK
| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · PostgreSQL · Sanctum |
| Files | `public` disk — `products/images`, `products/attachments`, `products/qc`; URLs via `file_url()` |
| Cache | Laravel `Cache::remember` (per-user master bundle, 5 min) + browser `sessionStorage` |
| Frontend | React 19 · TS · Velzon/Bootstrap/Tailwind · custom `prd-*` CSS (`product-management.css`) |

---

## 3. DATABASE SCHEMA

### 3.1 `products`
`SoftDeletes`. FKs `client_id`/`branch_id` → cascade on delete; `created_by` → null on delete. Lookup ids (`segment_id`, `haz_class_id`, `uom_id`, `hsn_id`, `condition_id`, `packaging_material_id`, `gst_id`) are **plain integers, no FK**.

| Group | Columns |
|---|---|
| Tenancy | client_id, branch_id, created_by |
| Identity | product_code (≤50), name (≤255), generic_name, description (text), brand (text since 2026_07_14) |
| Classification | segment_id (→ clm_segments), haz_type (≤20), haz_class_id, uom_id, hsn_id, condition_id, packaging_material_id, confidential_info (text) |
| Media | primary_image (≤500), secondary_images (JSON), product_attachment (≤500) |
| Selling | base_price, gst_id, gst_amount, total_price (15,2), mark_bottom (≤30) |
| Quality (legacy) | net_weight, gross_weight (12,3), length_cm, width_cm, height_cm (12,2), batch_no, serial_no, cat_no, lot_no (≤100) |
| Lifecycle | status (≤20, default `draft`), step_completed (0–4), zoho_item_id (≤64) |

**Indexes:** `(client_id, branch_id, status)`, `name`, **unique `(client_id, branch_id, product_code)`** (`products_client_branch_code_unique`). History: global unique → `(client_id, product_code)` (2026_05_20) → per branch (2026_07_14). PostgreSQL treats NULLs as distinct, so rows with a NULL `branch_id` are not protected by the index.

**Data migration:** `2026_05_19_000023_strip_blob_urls_from_products` nulls `blob:` primary images and strips them from `secondary_images`.

### 3.2 `product_qc_records`
`product_id` (cascade), `qc_name` (≤100, required), `qc_purpose`, `issued_by`, `qa_testing_parameter` (text), `min_acceptance_criteria` (text), `attachment_path` (≤500). No soft deletes — replaced wholesale by the Quality step.

### 3.3 `product_vendor_maps`
`product_id` (cascade), `vendor_id` (nullable FK → vendors, null on delete), `vendor_code`, `vendor_name` (required), `vendor_website`, `contact_person`, `contact_no`, `email`, `designation`, `attachment_path`, `purchase_price` (15,2), `gst_percentage` (6,2), `gst_amount`, `total_amount`, `map_date`, `remarks`. No soft deletes — hard-replaced by the Vendors step.

### 3.4 `vendor_product_mappings` (vendor-side mirror)
`vendor_id`, `product_id` (both cascade), `batch_serial_lot`, `purchase_price`, `gst_percentage`, `gst_amount`, `total_amount`, `created_by`, `SoftDeletes`. Written by ProductController and by `VendorController::storeProducts` (which in turn mirrors into `product_vendor_maps`).

---

## 4. MODEL (`app/Models/Product.php`)

```php
class Product extends Model {
    use HasFactory, SoftDeletes;
    protected $casts = ['secondary_images'=>'array', 'base_price'=>'decimal:2', 'gst_amount'=>'decimal:2',
        'total_price'=>'decimal:2', 'net_weight'=>'decimal:3', 'gross_weight'=>'decimal:3',
        'length_cm'/'width_cm'/'height_cm'=>'decimal:2', 'step_completed'=>'integer'];
    protected $appends = ['primary_image_url', 'secondary_images_url', 'product_attachment_url'];
    // accessors skip blank / blob: values and resolve via file_url()

    // relations: client, branch, creator, segment (Segments), hazClass, uom, hsn (HsnCodes),
    //   condition, packagingMaterial, gstPercentage (gst_id), qcRecords (hasMany), vendorMaps (hasMany)
    public function nextStep(): int;   // min(step_completed + 1, 4)
}
```
`ProductQcRecord` appends `attachment_url`; `ProductVendorMap` casts prices `decimal:2`, `map_date` `date`, and belongs to `Product` and `Vendor`.

---

## 5. API ENDPOINTS CONFIGURATION

```php
Route::middleware(['auth:sanctum', 'user.active', 'tenant'])->group(function () {
    Route::get   ('/products/stats',                     [ProductController::class, 'stats']);
    Route::get   ('/products/owners',                    [ProductController::class, 'owners']);
    Route::get   ('/products/master-bundle',             [ProductController::class, 'masterBundle']);
    Route::get   ('/products',                           [ProductController::class, 'index']);
    Route::get   ('/products/{id}',                      [ProductController::class, 'show']);
    Route::get   ('/products/{id}/usage',                [ProductController::class, 'usage']);
    Route::get   ('/products/{id}/vendor-maps',          [ProductController::class, 'vendorMaps']);
    Route::patch ('/products/{id}/vendor-maps/{mapId}',  [ProductController::class, 'updateVendorMapPrice']);
    Route::delete('/products/{id}/vendor-maps/{mapId}',  [ProductController::class, 'destroyVendorMap']);
    Route::post  ('/products/step/core',                 [ProductController::class, 'storeCore']);
    Route::put   ('/products/{id}/step/sales',           [ProductController::class, 'storeSales']);
    Route::put   ('/products/{id}/step/quality',         [ProductController::class, 'storeQuality']);
    Route::put   ('/products/{id}/step/vendors',         [ProductController::class, 'storeVendors']);
    Route::delete('/products/{id}',                      [ProductController::class, 'destroy']);
});   // all {id}/{mapId} constrained with whereNumber — routes/api.php lines 167–181
```
Full detail in **PRODUCT_API_DOCUMENTATION.md**.

---

## 6. CONTROLLER ANALYSIS (`ProductController`)

No `authorize()`/permission-slug check exists in this controller. Access = route middleware + `applyScope` (read) + `editDenial` (write).

| Method | Purpose | Auth / notes |
|---|---|---|
| `index` | Paginated list (default 24, max 200), filters, sort, `lite`, `counts` | applyScope with switcher branch filter; dept mask |
| `stats` | Mapped / zero-supplier counts | same scope + filters |
| `show` | Detail + `segment_uploads` (QC) | applyScope (no switcher); dept mask |
| `storeCore` | Create (code + `draft`) / update Core, files | editDenial on update; GST lock |
| `storeSales` | Price/GST; `draft→inactive`; cascades GST to maps + mirror | editDenial; GST lock; transaction for maps |
| `storeQuality` | Weights/dims/inventory + QC full replace (`products/qc/`) | editDenial; transaction (legacy, unused by UI) |
| `storeVendors` | Full replace of maps; segment gate; GST forced; mirror; vendor activation | editDenial; transaction |
| `updateVendorMapPrice` / `destroyVendorMap` | Single-row price edit / unmap + mirror | editDenial; transaction |
| `vendorMaps` | Raw map rows | applyScope; Sales dept → empty |
| `usage` | Leads / PO / PI / SPI references, `segment_locked`, `gst_locked` | applyScope; `client_id` from token |
| `destroy` | Soft delete | editDenial('delete'); **no usage check** |
| `owners` | Same-branch branch_user/employee list | non-branch users → `[]` |
| `masterBundle` | 7 active masters + scoped vendors | per-user cache 5 min; applyReadScope per master |

**Edit rule:** `isBranchMember` (employee, same client + branch, row has a branch) → allowed; otherwise `hierarchicalDenial` — creator allowed, other employees denied, else row-tier (from `client_id`/`branch_id` stamps) must be ≤ user tier.

---

## 7. FRONTEND

### 7.1 `Products.tsx` — list
Route `/products` (`components/App.tsx`), menu leaf `p2p.product` (`LayoutMenuData.tsx` maps it to `/products`). Page gated to `branch_user`/`employee`. Server-side paging (`DEFAULT_PAGE_SIZE = 12`), tabs send `supplier=mapped|zero`, badges from `counts`. Filters sent: `q`, `status`, `vendor_id`, `segment_eq`, `segment[]`, `hsn[]`, `condition[]`, `haz_class[]`, `created_bucket[]`. 220 ms debounce + `AbortController`.

### 7.2 `AddProductModal.tsx` — form
Tabs `core` → `sales` (`Tab` type still lists `quality`, not rendered). Client-side required fields mirror §3.1 of the functional doc. Calls `/usage` before segment and GST changes. Map Supplier popup persists via `step/vendors` immediately; lazy-loads `SupplierScopeGate` + `AddVendorModal` for inline supplier creation.

### 7.3 `ProductView.tsx` — detail
`/products/:id` or embedded; reads `GET /products/{id}`, uploads QC docs via `/segment-uploads/product/{id}`.

### 7.4 Other consumers
Sales Matrix `ProductDirectoryModal` (`GET /products`) and `VendorMappingsModal` (`GET /products/{id}/vendor-maps`); `AddVendorModal` (`/products?per_page=500&lite=1`); `CreatePoWizard` / `po-api.ts` / `SpiDetail`; `P2p\SourcingController` (`/p2p/products`); `ZohoBooksService::findOrCreateItemId`.

### 7.5 Pagination
`index()` is server-paged: `$perPage = max(1, min((int) per_page ?: 24, 200))` → `paginate()`. The response is the Laravel paginator array plus `counts` (`active` = `has('vendorMaps')`, `inactive` = `doesntHave('vendorMaps')`), counted on the scoped + filtered query **before** the `supplier` tab is applied, so badges show catalogue-wide totals, not page totals. `Products.tsx` keeps `page`/`pageSize` state (12 default; options 8/12/16/24/48), resets to page 1 when search/filters/tab/deep-link/page size change, clamps `page ≤ totalPages`, and renders `ProductPagination` ("Showing a–b of N", rows-per-page, `page / pages`, ‹ ›). No other product endpoint paginates (see API doc §3.9).

### 7.6 Product card data
`apiToCard()` maps each row. Code is padded by `formatProductCode`. `segment.title`, `hsn.hsn_code` and UOM fall back to `—`; `gst_percentage.percentage` falls back to 0. `vendorCount` = `vendor_count` (Sales mask) or `vendor_maps.length`. `images` = primary + secondary URLs. `rating`, `reviews` and `badge` are always 0/undefined. `owner*` reads `row.creator`, which `index()` never eager-loads. `ProductCard` status pill = `vendorCount > 0`; Suppliers link is hidden for `user.department === 'sales'`. `ProductRow` (list view) is the only component with a Delete button and the only one that shows price, but `view` is fixed at `'grid'`. `ProductView` derives its status chip from `vendor_maps.length` (empty for the Sales mask → always Inactive) and hides the price card for the Purchase department.

---

## 8. PRODUCT SELECTION IN DROPDOWNS (where & which products appear)

### 8.1 Server conditions shared by every `GET /products` caller
| Condition | Implementation |
|---|---|
| Soft-deleted | Excluded (`SoftDeletes` global scope) |
| Employee scope | `applyBranchScope`: `client_id IS NULL OR (client_id = user.client_id AND (branch_id IS NULL OR branch_id = user.branch_id))`; switcher ignored |
| Branch user scope | Same as employee (`applyReadScope` → `applyBranchScope`); switcher ignored |
| Client admin/user | `client_id IS NULL OR client_id = user.client_id`; `?branch_id` narrows only if that branch belongs to the client |
| Super admin | Everything; `?branch_id` narrows |
| Status | Only if `status` sent (`active`/`draft`; `inactive` = inactive+draft) |
| Vendor map | Only if `supplier=mapped|zero` or `vendor_id`/`vendor[]` sent |
| Search `q` | `ilike` on `name`, `product_code`, `brand`, `generic_name`, `hsn.hsn_code`; numeric tail also matches `%-<n padded 1–4>` |
| Order / limit | `id DESC`; `per_page` default 24, max 200 |
| Department mask | Purchase: selling fields null, `gst_percentage` removed · Sales: `vendor_maps=[]`, `vendor_count` |

### 8.2 Per screen
| Screen · file | Endpoint & params | Extra conditions (frontend unless noted) | Label |
|---|---|---|---|
| Sales Matrix Product Directory · `matrix/ProductDirectoryModal.tsx` | `GET /products` (24) | Hide products already on the lead; disable off-customer-segment (ids, else names); Active/Inactive badge. Server on save: `exists:products,id`, duplicate 422, segment-party + customer-segment guards, one currency per lead | `P-007 · name` |
| Quotation / PI · `SalesQPI.tsx` | `GET /sales/qpi/master-bundle` → `ProductController::index(per_page=200, status=active, branch_id)` | Restrict to the opportunity's shared-price products (else its directory products); hide already-added; disable off-segment | `P-007 – name` |
| PO legacy · `purchase-order/CreatePoWizard.tsx` | `GET /products` (24) | Hide products on other lines; freeze if supplier segment names ∌ product segment; sample fallback list until loaded | name + code + segment |
| PO new · `create-po/use-po-lookups.ts` + `ProductTable.tsx` | `GET /products?lite=1&per_page=200` | Lock if `status ≠ active`; lock on segment mismatch unless the product is mapped to the supplier directly; PI line must keep the PI segment | `P-007 — name` |
| SPI · `supplier-purchase-invoice/SpiDetail.tsx` | `GET /products?status=active` (24) | Hide products on other lines; freeze if `segment_id ∉ supplier segments` (no-segment allowed) | name + code + segment |
| Supplier Map Product · `supplier-management/AddVendorModal.tsx` | `GET /products?per_page=500&lite=1` (→200) | Drop no-segment; only supplier's segments; hide already mapped (except edited) | `P-007 — name` + segment |
| Bulk sourcing · `bulk-sourcing/AssignSourcingTargetModal.tsx` | `GET /p2p/products` → `SourcingController::products` | Server: `client_id = user.client_id` (no globals), `branch_id = user.branch_id ?: ?branch_id`, any status, no limit, numeric code order. Client: substring search on code+name, sort code desc, "(added)" rows disabled | `P-007 — name` |
| Stage 3/4/6, Sourcing, Price Shared · `matrix/*` | `GET /sales/leads/{id}/products` | Lead's own rows; tabs by `sourcing_status`; Stage 4 prices only `product_status = active` | code + name |
| PO from shipment · `CreatePoWizard.tsx` | `GET /p2p/purchase-orders/shipments/{id}/pi-products[?exclude_po]` | PI lines with ordered/pending qty (not the master) | — |

Header search (`SearchOption.tsx`) only routes to `/products`; `ClmCtcForm` passes `hideProductTab` and loads no products.

---

## 9. SECURITY & CAVEATS
1. **No module permission server-side** — `p2p.product` gates only the menu; the SPA user-type check is client-side.
2. **Code race** — `nextProductCode` scans `withTrashed` codes with no lock/transaction; a collision surfaces as a unique-violation.
3. **Cross-tenant vendor id** — `vendors.*.vendor_id` uses `exists:vendors,id` without tenant scope; the mirror + vendor auto-activation then run on that vendor.
4. **Delete** — no usage check; soft delete leaves map/mirror rows in place (FK cascade fires only on hard delete).
5. **Department wall** is read-only masking; writes are not blocked.
6. **Comment drift** — `applyScope` says staff cannot modify branch products, but `isBranchMember` allows it.
7. **Lookup ids** are validated as integers only (no `exists`, no FK).
8. **Picker truncation**: callers without `per_page` get 24 rows; `per_page=500` is capped at 200, so older products drop out of the Directory, PO, SPI and Supplier pickers.
9. **Mask leaks into pickers**: Purchase-dept users get no `base_price`/GST in PO/SPI product options.
10. **Unreachable delete**: Delete is only on `ProductRow` (list view), and nothing switches the page to the list view.

---

## 10. METRICS
| Metric | Value |
|---|---|
| ProductController LOC | ~1572 |
| Endpoints | 14 |
| Tables | products, product_qc_records, product_vendor_maps (+ vendor_product_mappings mirror) |
| Product migrations | 11 (create ×3, blob strip, inventory, code unique ×2, vendor_id, attachment, brand, zoho_item_id) |
| DB transactions | storeSales (maps), storeQuality, storeVendors, map PATCH/DELETE |
| Permission slug | `p2p.product` (menu only) |
| Test coverage | none automated |

---

*Related documents: PRODUCT_FUNCTIONAL_DOCUMENTATION.md · PRODUCT_CODE_WALKTHROUGH.md · PRODUCT_API_DOCUMENTATION.md*
