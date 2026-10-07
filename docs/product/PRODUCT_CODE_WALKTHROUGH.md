# PRODUCT MODULE — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · P2P → Master Management → Product Management
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-10-06 | System | Initial code walkthrough |
| 1.1 | 2026-10-07 | System | Added dropdown conditions, pagination, product card |

---

## 0. HOW TO READ
Traces: list → create (Core) → Sales → Vendors → usage locks → delete. Line numbers may drift. Legend: `→` a call · `⇒` a return. Files: `ProductController.php`, `Product.php`, `ProductVendorMap.php`, `MasterVisibility.php`, `Products.tsx`, `AddProductModal.tsx`, `ProductView.tsx`.

---

## 1. SCOPING & GUARDS

### `applyScope()` (44)
```php
$branchFilter = $applyBranchFilter ? ($request->integer('branch_id') ?: null) : null; // list/stats only
if ($user->user_type === 'employee') {
    MasterVisibility::applyBranchScope($query, $user);    // globals + client-level + own branch
    return $query;
}
MasterVisibility::applyReadScope($query, $user, $branchFilter); // super/client/branch tiers
```
`show`/steps call it **without** the opt-in, so the injected `?branch_id=` never 404s a single product.

### `editDenial()` (241) / `isBranchMember()` (249)
```php
if ($this->isBranchMember($user, $product)) return null;   // employee, same client + same branch
return MasterVisibility::hierarchicalDenial($user, $product, $action);
// hierarchicalDenial: creator → allowed; other employee → denied; else tier ladder (row stamp vs user)
```

### `departmentHiddenGroups()` (369) → `maskProductArray()` (398)
```php
$deptName = Departments::whereKey(Employee::where('user_id',$user->id)->value('department_id'))->value('name');
'purchase' → hide selling: null base_price/gst_id/gst_amount/total_price/mark_bottom, unset gst_percentage
'sales'    → hide vendor:  vendor_count = count(vendor_maps); vendor_maps = []
```
Applied to every product-returning response (list, show, every step).

---

## 2. LISTING

### `index()` (460)
```php
$query = Product::query()->with($lite ? ['hsn','segment','gstPercentage']
          : ['segment','hazClass','uom','hsn','condition','packagingMaterial','gstPercentage',
             'vendorMaps:id,product_id,vendor_name','qcRecords:id,product_id']);
$query = $this->applyScope($query, $request, true);
$query = $this->applyListFilters($query, $request);          // (71) shared with stats()
$mappedCount = (clone $query)->has('vendorMaps')->count();   // badges BEFORE the tab
$zeroCount   = (clone $query)->doesntHave('vendorMaps')->count();
$query = $this->applySupplierTab($query, $request);          // (222) supplier=mapped|zero
match ($request->query('sort')) { 'price-asc' => orderBy('total_price'),
    'price-desc' => orderByDesc('total_price'), default => orderByDesc('id') };
$perPage = max(1, min((int) $request->query('per_page', 24), 200));
$products = $query->paginate($perPage);                     // + mask each row if needed
return response()->json($products->toArray() + ['counts' => ['active'=>$mappedCount,'inactive'=>$zeroCount]]);
```
`applyListFilters` escapes `%`/`_`, uses `ilike` (PostgreSQL), ORs the `created_bucket` windows, and spells out `whereNull('haz_type')` for the NON HAZ filter.

### `stats()` (1384)
Same `applyScope(…, true)` + `applyListFilters`, returns `{active, inactive, total}` from the two vendor-map counts.

---

## 3. CREATE / UPDATE CORE

### `storeCore()` (614)
```php
// CRLF → LF on description / confidential_info, then validate (name ≤100, description ≤10000, files…)
$product = isset($data['id']) ? $this->applyScope(Product::query(), $request)->findOrFail($data['id'])
                              : new Product();
if ($product->exists) {
    if ($denial = $this->editDenial(...)) return 403;
    if ($gstDenial = $this->gstChangeDenial($product, $data, $clientId)) return 422; // errors.gst_id
}
if (!$product->exists) {
    $product->fill($this->ownershipFor($request));          // client_id, branch_id, created_by
    $product->product_code = $this->nextProductCode($clientId, $branchId);
    $product->status = 'draft';
}
$product->fill(scalars);
// primary image:  new file → delete old + storeFileWithName('products/images')
//                 string   → keep / clear ('' = clear; blob: rejected)
// secondary:      kept list (or secondary_images_replace) − removed files + appended uploads
// attachment:     same 3-case contract → 'products/attachments'
$product->step_completed = max((int) $product->step_completed, 1);
$product->save();
⇒ masked $product->fresh()
```

### `nextProductCode()` (426)
```php
$q = Product::withTrashed();                                 // deleted codes never reused
// where client_id = ? AND branch_id = ? (whereNull for nulls)
foreach ($q->pluck('product_code') as $code) preg_match('/(\d+)$/', …) → $max
return 'P-' . str_pad($max + 1, 3, '0', STR_PAD_LEFT);       // P-001 … P-999, then P-1000
```
> No `lockForUpdate` and no transaction — unique index `(client_id, branch_id, product_code)` is the only guard.

### `storeFileWithName()` (848)
`{dir}/{8-hex}__{sanitised-original}.{ext}` on the `public` disk; the SPA strips up to `__` for display. `relativePath()` (827) normalises legacy `/storage/…` or absolute URLs before `Storage::delete`.

---

## 4. SALES STEP

### `storeSales()` (864)
```php
$product = scoped findOrFail; editDenial → 403;
$data = validate(base_price, gst_id, gst_amount, total_price, mark_bottom);
if ($denial = $this->gstChangeDenial(...)) return 422;
$product->fill($data); step_completed = max(…, 2); draft → inactive; save();
$gstPct = GstPercentage::find($product->gst_id)?->percentage ?? 0;
DB::transaction: foreach vendorMaps → gst_amount = round(price*pct/100,2), total = price+gst
                 + VendorProductMapping::where(vendor_id, product_id)->update(same)
```

### `gstChangeDenial()` (319) → `gstLockDocuments()` (300) → `issuedDocumentCodes()` (263)
Only a real change of `gst_id` is checked. Lock docs = latest PO + latest PI + latest SPI code that holds the product (client-scoped joins; soft-deleted POs/SPIs excluded).

---

## 5. VENDORS STEP

### `storeVendors()` (1224)
```php
validate(vendors: present|array, vendors.*.vendor_name required, …);
if ($product->segment_id && $vendorIds) {
    foreach (Vendor::with('segments:id')->whereIn('id',$vendorIds) as $ven)
        $segs = [scalar segment_id] ∪ pivot segment ids;
        if (!in_array($prodSeg, $segs)) $mismatches[] = $ven->company_name;
    if ($mismatches) return 422 'Segment mismatch: …';
}
$gstPct = product GST %;
DB::transaction(function () {
    $product->vendorMaps()->delete();                         // full replace
    foreach ($data['vendors'] as $v) {
        force gst_percentage=$gstPct; recompute gst_amount/total_amount;
        $product->vendorMaps()->create($v);
        VendorProductMapping::updateOrCreate([vendor_id, product_id], prices + created_by);
        Vendor::find($vendorId) → step_completed=max(…,4), status='active';
    }
    VendorProductMapping::where('product_id',…)->whereNotIn('vendor_id', $now)->delete(); // stale mirrors
    empty($data['vendors']) ? status='inactive' : (step_completed=4, status='active');
});
```

### `updateVendorMapPrice()` (1138) / `destroyVendorMap()` (1189)
Single-row ops scoped by `product_id`. PATCH recomputes from the row's stored `gst_percentage` and mirrors vendor side; DELETE removes the vendor-side mirror then the map (product status left unchanged).

---

## 6. USAGE, DELETE, HELPERS

### `usage()` (1041)
```php
$clientId = $request->user()->client_id;                     // never from request
leads = LeadProduct ⋈ leads (not deleted) ⟕ customers → {lead_id, opp_code, has_customer, customer_name}
$docs = issuedDocumentCodes(); gst_lock_codes = gstLockDocuments($docs)
⇒ segment_locked = any lead with customer || PO || SPI;  gst_locked = PO || PI || SPI
```

### `destroy()` (1370)
```php
scoped findOrFail; editDenial($user, $product, 'delete') → 403;
$product->delete();                                          // SoftDeletes — no usage check
⇒ ['deleted' => true]
```

### `show()` (546) · `owners()` (1425) · `masterBundle()` (1472)
`show` eager-loads all relations + `vendorMaps.vendor:id,vendor_code`, then delegates to `SegmentDocUploadController::index($request,'product',$id)` with `category=qc` inside `safeDelegate()` (597) and appends `segment_uploads`. `owners` returns same-branch `branch_user`/`employee` users. `masterBundle` caches per user (`MasterBundleCache::key('product:master-bundle', $userId)`, 5 min) — active rows via `LOWER(status)='active'` + `applyReadScope`; vendors via `Vendor::forUser()` with `segment_ids`, `state`, `primary_address`.

---

## 7. FRONTEND

### `Products.tsx`
```tsx
allowed = user_type === 'branch_user' || user_type === 'employee'   // else "Branch / Employee only"
GET /products { ...filters, supplier: tab==='active' ? 'mapped' : 'zero', sort, page, per_page: 12 }
    // 220 ms debounce, AbortController cancels superseded requests, badges from body.counts
GET /products/master-bundle                                   // sidebar filter options
DELETE /products/{id}                                         // DeleteConfirmModal (only via list-view row)
```

### `AddProductModal.tsx`
```tsx
GET /products/master-bundle (sessionStorage cache 'product:master-bundle:v6', 5 min)
GET /products/{id}                                            // edit mode
POST /products/step/core (multipart)  → GST "Map GST" popup must pick gst_id on create
GET /products/{id}/usage   // before a segment change (in_po_or_spi / blocking_leads) and GST change (gst_locked)
PUT /products/{id}/step/sales          // base_price > 0 + gst_id required client-side
PUT /products/{id}/step/vendors        // Map Supplier popup persists the full list immediately
```
Purchase-dept users finish after Core (`isPurchaseDept`); Sales-dept users never see the supplier section.

### `ProductView.tsx`
`GET /products/{id}` (detail card, Mapped Suppliers, QC uploads) · `POST /segment-uploads/product/{id}` (QC docs).

### 7.1 Pagination trace (`Products.tsx`)
```tsx
const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE); // 12
listParams  = { q, status?, vendor_id?, segment_eq?, segment[], hsn[], condition[], haz_class[], created_bucket[] }
appliedParams = debounce(listParams, 220ms)                   // search itself is debounced first
refresh(): abort previous → GET /products { ...appliedParams, supplier, sort, page, per_page: pageSize }
        ⇒ setProducts(body.data.map(apiToCard)); setTotal(body.total); setStats(body.counts)
useEffect(() => setPage(1), [debouncedQ, segment, statusFilter, statusTab, sort, filters, vendorFilterId]);
setRowsPerPage(n) → setPageSize(n); setPage(1)               // ROWS_PER_PAGE_OPTIONS = [8,12,16,24,48]
totalPages = max(1, ceil(total / pageSize)); if (page > totalPages) setPage(totalPages)
<ProductPagination> "Showing a–b of total" · Rows per page · "page / totalPages" · ‹ ›
```
Server side (`index`, §2): badges counted on the filtered query **before** `applySupplierTab`, then `paginate(clamp(per_page,1,200))`.

### 7.2 Card trace (`apiToCard` → `ProductCard`)
```tsx
id        = formatProductCode(product_code ?? `P-${id}`)          // pad to 3 digits
segment   = row.segment?.title ?? '—';   hsn = row.hsn?.hsn_code ?? '—'
gstRate   = Number(row.gst_percentage?.percentage ?? 0)           // 0 when masked
vendorCount = row.vendor_count ?? row.vendor_maps.length          // Sales mask supplies vendor_count
hazClass  = haz_type startsWith 'haz' && !includes 'non' ? 'HAZ' : 'NON HAZ'
images    = [primary_image_url || primary_image, ...secondary_images_url]
rating/reviews = 0; owner* from row.creator (never loaded → empty)
ProductCard: isActive = vendorCount > 0 → green/red pill; canViewSuppliers = !isSalesDept
  actions: thumb/title → View (ProductView overlay) · ✎ → Edit · "N Suppliers" → Suppliers
           Wishlist/Cart → toast.info(act) · (Delete exists only on ProductRow — list view, unreachable)
```
`view` is initialised to `'grid'` and `sort` to `'recent'`, and the page never calls `setView`/`setSort`, so neither can change.

### 7.3 Picker traces
```tsx
// Sales Matrix — ProductDirectoryModal
GET /products                         ⇒ page 1, 24 rows (default per_page)
availableProducts = products.filter(p => !mappedIds.has(p.id) || p.id === draft.product_id)
option = { label: `${formatProductCode(code)} · ${name}`, badge: Active|Inactive,
           badges: [segment], disabled: customerSegmentIds ? prodSegId∉ids : segName∉customerSegs }
POST /sales/leads/{id}/products       // exists:products,id · dupe 422 · segment guards · currency lock

// Quotation / PI — SalesQPI
GET /sales/qpi/master-bundle → QuotationController::qpiMasterBundle (1136)
    bundleCall(ProductController::index, ['per_page'=>200,'status'=>'active'] + branch_id)
visibleProductOptions: allowedProductIds (shared-price ids ‖ directory ids) → segment badge/disable
                       → drop products already on the document

// PO legacy — CreatePoWizard          GET /products            (24) · disable if supplier segs ∌ segment
// PO new — use-po-lookups.ts           GET /products?lite=1&per_page=200
    lockedProducts: inactiveProduct(p) ?? segmentMismatch(p, supplierSegments, supplierProducts)
// SPI — SpiDetail                      GET /products?status=active (24) · disable if segId ∉ supSegIds
// Supplier — AddVendorModal            GET /products?per_page=500&lite=1 (→200)
    filter(segment_id != null) → mappableOpts: not already mapped && segment ∈ supplier segmentIds
// Bulk sourcing — AssignSourcingTargetModal
GET /p2p/products → SourcingController::products: where client_id = user.client_id
    when(user.branch_id ?: ?branch_id) where branch_id; order by numeric code series
pickList = filter((code+' '+name).includes(q)).sort(code desc, numeric) · added rows → "(added)"
```

---

## 8. CROSS-CUTTING PATTERNS
| Pattern | Where | Why |
|---|---|---|
| Opt-in branch filter | applyScope($applyBranchFilter) | Switcher narrows lists, never 404s a detail |
| Branch-shared catalog | applyScope / isBranchMember | Every branch employee sees + edits branch products |
| Department wall | maskProductArray | Purchase can't see selling price; Sales can't see suppliers |
| Two-sided mirror | storeVendors / storeSales / map PATCH/DELETE | product_vendor_maps ↔ vendor_product_mappings |
| Server-derived GST | storeVendors / storeSales | Supplier GST always equals product GST |
| Usage report | usage() + gstChangeDenial | UI pre-check and save-time guard share one query |
| withTrashed code scan | nextProductCode | Deleted codes are not re-issued |

---

## 9. NOTES & CAVEATS
- No server-side permission check; the SPA's user-type gate is the only UI-level restriction.
- `nextProductCode` is not locked — concurrent creates can raise a unique-violation (500).
- `destroy()` ignores usage; soft delete leaves `product_vendor_maps` / `vendor_product_mappings` rows untouched.
- `applyScope` comments say staff "can VIEW but not modify", but `isBranchMember` lets same-branch employees edit.
- DB is PostgreSQL — `ilike`, `not ilike`, JSON `secondary_images`.

---

*Related documents: PRODUCT_TECHNICAL_DOCUMENTATION.md · PRODUCT_FUNCTIONAL_DOCUMENTATION.md · PRODUCT_API_DOCUMENTATION.md*
