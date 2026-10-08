# SUPPLIER MODULE — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · P2P → Master Management → Supplier Management
> Execution-order trace of the real code paths. (UI "Supplier" = code "Vendor".)

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-10-06 | System | Initial code walkthrough |
| 1.1 | 2026-10-07 | System | Added dropdown conditions, pagination, supplier card |

---

## 0. HOW TO READ
Traces: list → identity (create + code allocation) → contacts → KYC → products → delete. Line numbers are from `VendorController.php` (2061 lines) and may drift. Legend: `→` a call · `⇒` a return. Files: `VendorController.php`, `Vendor.php`, `MasterVisibility.php`, `Vendors.tsx`, `AddVendorModal.tsx`.

---

## 1. LISTING & SCOPE

### `Vendor::scopeForUser()` (Vendor.php 150)
```php
if ($user->user_type === 'employee') { MasterVisibility::applyBranchScope($q, $user); return $q; }
MasterVisibility::applyReadScope($q, $user, $branchFilter);   // switcher only for client_admin/client_user
```
Employees see the **whole branch book** (globals + client-level + own branch), deliberately overriding the peer-isolated employee default.

### `index()` (101)
```php
if ($request->boolean('light')) { /* picker: id, code, name, country, mobile, email — no paging */ }
$q = Vendor::query()->forUser($user, $request->integer('branch_id') ?: null)
    ->with([...primaryAddress.state/country, addresses, vendorType, segment(s), riskLevel, complianceBehaviour])
    ->withCount('productMappings')
    ->addSelect(DB::raw('0 as opportunity_count'))         // Recurring tab parked (2026-07-13)
    ->orderByDesc('id');
// q (ilike, many columns + whereHas), status, scope domestic|international, tab=recurring → 1=0
$facet = fn () => clone $q (no eager loads / order / columns);   // counts BEFORE facet filters
$complianceById = SupplierCompliance::statuses($scopedIds, $clientId);   // derived, bulk
// categories / compliance filters → paginate(per_page ?: 24) → stamp compliance_status per row
⇒ paginator + facets{grand_total, category{…}, compliance{…}}
```

### `show()` (435)
```php
$vendor = Vendor::query()->forUser($user)->with(self::SHOW_WITH)->findOrFail($id);
$segmentUploads = $this->safeDelegate(fn () => (new SegmentDocUploadController)->index($request,'supplier',$id));
$lockSrc = SegmentGuard::vendorLockSources(...);  // po / spi segment names
$prodNames = SegmentGuard::productMappingSegmentNames(...);
// → locked_segments + locked_segment_reasons (product < spi < po, strongest wins)
$data['state_locked'] = PurchaseOrder::where('vendor_id', $vendor->id)->exists();
// + segment_required_doc_keys, uploaded_doc_keys (for the removal guard UI)
```

---

## 2. STEP 1 — IDENTITY (create + code)

### `storeIdentity()` (595)
```php
$data = $request->validate([...], [], self::FIELD_LABELS);
$address = $data['address'] ?? null; unset($data['address']);
// vendor_type / vendor_behaviour NAME → firstOrCreate master row per client
$segIds = $this->normalizeSegmentIds($request->input('segment_ids'), $data['segment_id'] ?? null, $user->client_id);
$countryId = $address['country_id'] ?? stored primary address country (edit);
// intl  → TIN required, regex, strtoupper     | domestic + gst_applicable=No → gst_number=null
// India → gst_applicable must be 'Yes'
// GSTIN must start with state code — reads $data['address']['state_code'] (see §9)
if ($isEdit) { $vendor = forUser()->findOrFail(id); hierarchicalDenial(...,'edit'); }  // always null for Vendor
$this->assertGstUniqueForClient($clientId, $gst, $exceptId);   // vendors + vendor_gst_scrutiny
// removed segments: product-mapping lock 422 → PO/SPI lock 422 → orphan docs 409 unless confirmed
DB::transaction(function () {
    if ($isEdit) { fill; step_completed = max(.,1); save; }
    else {
        $vendor = new Vendor($data) + client_id/branch_id/created_by from user, status 'draft', step 1; save();
        DB::table('clients')->where('id', $clientId)->lockForUpdate()->first();   // serialise
        $vendor->vendor_code = $this->nextVendorCode($clientId, $branchId); save();
    }
    $vendor->segments()->sync($segIds);
    // confirmed removal → delete orphan SegmentDocUploads (+ files)
    // upsert primary VendorAddress (address fields only; contact_name '' if new; type 'Registered Office')
});
MasterBundleCache::bump();
⇒ ['data' => $this->shape($vendor)]
```

### `nextVendorCode()` (1797)
```php
$codes = Vendor::withTrashed()->where('client_id', $c)
    ->when($branchId === null, whereNull('branch_id'), where('branch_id', $branchId))->pluck('vendor_code');
$max = max of trailing digits;  ⇒ 'S-' . str_pad($max + 1, 3, '0', STR_PAD_LEFT)
```
Backed by unique index `(client_id, COALESCE(branch_id,0), vendor_code)` — non-partial, so trashed codes stay reserved.

---

## 3. STEP 1b — CONTACTS

### `storeContacts()` (980)
```php
// validate primary_address.* (contact_name required) + primary_attachment
DB::transaction: addresses()->where('is_primary', true)->delete();
    $path = absorbFile($request, 'primary_attachment', $id, 'contact', echoed attachment_path);
    VendorAddress::create([...primary_address, is_primary => true, attachment_path => $path]);
    $vendor->primary_email = Str::lower(trim(email)); step_completed = max(.,1); save();   // EnforcesUniqueEmail fires
    delete replaced business card from disk
```

### `storeContact` (1073) · `updateContact` (1098) · `destroyContact` (1136)
Scoped to `is_primary = false` → the primary row 404s. `validateContact()` (1158) lower-cases email. `remove_attachment=1` forces a NULL fallback so the old file is dropped. `VendorAddress` has no SoftDeletes — delete is physical.

---

## 4. KYC SUB-RESOURCES

### Bank — `storeBankAccount` (1204) / `updateBankAccount` (1241) / `destroyBankAccount` (1282)
```php
$data = $this->validateBank($request, $vendor);   // vendorIsIndian(): IFSC+9–18 digits | SWIFT+8–34 alnum
// duplicate account_number for this vendor → 422
VendorBankAccount::create([... 'ifsc' => strtoupper(...), 'cheque_path' => absorbFile('cheque') ]);
// destroy → forceDelete() + unlink cheque
```

### GST scrutiny — `storeGstScrutiny` (1377) / `updateGstScrutiny` (1406) / `destroyGstScrutiny` (1432)
```php
$gst = strtoupper($data['gst_number']); $this->assertGstNumberUnique($vendor, $gst);
VendorGstScrutiny::create([...]);
VendorGstScrutiny::where('vendor_id', $vendor->id)->update(['gst_number' => $gst]);  // all rows in sync
```

---

## 5. STEP 2 — KYC DOCUMENTS

### `storeKyc()` (1528)
```php
// validate due_diligence.*, owner_kyc.*, trade_licenses.* + dd_files/owner_files/tl_files
DB::transaction(function () {
    $kept = all existing_path values in payload;
    foreach (documents.attachment_path + owners.attachment_path as $p) if (!$kept->contains($p)) Storage::delete($p);
    $vendor->documents()->forceDelete(); $vendor->owners()->forceDelete();      // replace-all
    // re-create: VendorDocument kind 'dd' | VendorOwner | VendorDocument kind 'tl'
    $vendor->step_completed = max(., 2); if (status === 'draft') status = 'inactive'; save();
});
```

---

## 6. STEP 3 — PRODUCT MAPPINGS

### `storeProducts()` (1666)
```php
// 'mappings' present|array; duplicate product_id → 422
DB::transaction(function () {
    $vendor->productMappings()->forceDelete();
    foreach ($mappings as $row) {
        VendorProductMapping::create([...]);
        ProductVendorMap::updateOrCreate(['product_id','vendor_id'], $vendorSnapshot + prices + map_date);
    }
    Product::whereIn('id', $mapped)->update(['status'=>'active','step_completed'=>GREATEST(step_completed,4)]);
    ProductVendorMap::where('vendor_id', $id)->whereNotIn('product_id', $mapped)->delete();
    if ($mapped) { step_completed = 4; status = 'active'; save(); }
});
```
The product side (`ProductController::storeVendors`) mirrors back into `vendor_product_mappings`, so the two tables stay symmetric from either end.

---

## 7. DELETE

### `destroy()` (566)
```php
$vendor = forUser()->findOrFail($id); hierarchicalDenial(..., 'delete');   // null for Vendor
$this->deleteAllVendorFiles($vendor);   // documents, owners, cheques, address attachments
$vendor->delete();                      // SoftDeletes — child rows are NOT cascaded
MasterBundleCache::bump();
⇒ ['id' => $id, 'deleted' => true]
```

---

## 8. FRONTEND

### `Vendors.tsx` (list, 1580 lines)
```tsx
const allowed = user?.user_type === 'branch_user' || user?.user_type === 'employee';  // else "Branch / Employee only"
GET /vendors { page, per_page, q, categories, compliance, scope, tab }   // stale-response guard via reqRef
GET /vendors/master-bundle                    // + vendorBundleCache.ts (browser cache)
GET /vendors/{id}                             // ?edit=<id> deep link (Bulk Sourcing → Mapped Suppliers)
// Add Supplier → SupplierScopeGate (Domestic | International) → AddVendorModal
// row actions: Mapped Products badge/popup · Edit Supplier · Evidence Vault (Zoho Entry commented out)
```

### `AddVendorModal.tsx` (wizard, 6459 lines) — 3 UI steps
```tsx
POST /vendors/step/identity                   // 409 requires_doc_confirmation → toast + revert segments
POST /vendors/{id}/step/contacts  (_method=PUT)
POST|DELETE /vendors/{id}/contacts[/{c}]  ·  /bank-accounts[/{b}]  ·  POST /gst-scrutiny
POST /vendors/{id}/step/kyc       (multipart)
POST /vendors/{id}/step/products               // also from MappedProductsViewPopup
POST /segment-uploads/supplier/{id}            // CLM segment-rule documents
```

---

## 9. NOTES & CAVEATS
- **GSTIN state-code check is dead code** (≈ line 769): it reads `$data['address']['state_code']` after `address` was `unset` from `$data` (line 666), so the prefix rule never fires — the same mistake the comment at 695 describes fixing for `$countryId`.
- `validateBank()` passes `FIELD_LABELS` as a 4th `validate()` argument; `Factory::validate` only takes messages + attributes, so the labels are ignored for bank errors.
- `storeKyc` deletes old files **inside** the transaction; a later rollback cannot restore them.
- `storeProducts` with `[]` keeps an already-`active` supplier active (it only skips promotion).
- `destroy` comment says child rows cascade; soft delete does not fire FK cascades, and `product_vendor_maps` rows are left in place.
- No restore endpoint; no PO/SPI usage guard before delete.

---

## 10. DROPDOWN / PICKER TRACES

### 10.1 Branch injection (`resources/js/api.ts` ~129)
```ts
if (method === 'get' && !skipUrls) {
  const stored = localStorage.getItem(`cbc_selected_branch_id_${user.id}`);
  if (stored > 0 && params.branch_id === undefined) config.params = { ...params, branch_id };
}
// server: forUser($user, $request->integer('branch_id') ?: null) — honoured only for client_admin/client_user/super_admin
```

### 10.2 Product → Map Supplier
```php
// ProductController::masterBundle (~1512) — cached 5 min per user
Vendor::query()->forUser($user)->with([primaryAddress…, vendorType, 'segments:id'])
    ->orderByDesc('id')->get([... 'status', 'segment_id'])
    ->map(fn ($v) => [..., 'segment_ids' => unique(scalar + pivot)]);
```
```tsx
// AddProductModal.tsx
mapVendorRows(res.data.vendors)                         // 136
vendorPickOpts = vendorOpts.filter(v => !mappedVendorKeys.ids.has(v.id) && !codes.has(v.code))  // 449
// add (≈708): alreadyMapped → toast; segmentId ∉ vendor.segmentIds (non-empty) → "Segment mismatch"
label: `${formatSupplierCode(v.code)}: ${v.name}`        // 1833
```

### 10.3 Bulk Sourcing → Map Supplier
```php
// SourcingController::suppliers
Vendor::query()->forUser($user, $branchId)->with(['segment:id,name','addresses','addresses.country:id,name'])
    ->orderBy('company_name')->get()
    ->map(→ id, code, name, segment, contact/mobile/email from addresses->first(), country, region);
// mapSupplier: forUser()->findOrFail(supplier_id); duplicate (product, vendor) → 422 (761)
```

### 10.4 Purchase Order → Select Supplier
```php
// PurchaseOrderController::suppliers
Vendor::query()->forUser($user, $branchId)->with(['primaryAddress:id,vendor_id,country_id','vendorType:id,name'])
    ->orderBy('company_name')->get([... 'supplier_category'])
    ->map(→ document_type = country ? (== India ? domestic : international) : domestic);
```
```tsx
// Step1LinkSupplier.tsx 134 — disabled options
blacklisted = supplier_category includes 'blacklist'
wrongType   = s.id !== draft.vendorId && supplier_type !== (draft.poType || OPEN_PO_TYPE)
// currencyLock (109): zohoCurrencySettled → every other currency disabled
// CreatePoWizard.tsx 598: suppliers.filter(s => s.code).sort(code desc)
```

### 10.5 SPI · CLM CTC · Sales Matrix
```php
SupplierPurchaseInvoiceController::suppliers   // forUser + branch, orderBy company_name → id, code, name, document_type
VendorController::index ?light=1              // forUser + branch, orderBy company_name, no paging
ProductController::vendorMaps                 // product_vendor_maps by product_id; [] for department-hidden users
```
```tsx
// MapSupplierPurchaseInvoiceModal 187: sort by numeric code desc
// ClmCtcForm 3224: filter (name+id+email).includes(search) && isDomesticCountry(country) === requiredDomestic
// useVendorMappings: list.length === 0 → popup not opened
```

---

## 11. PAGINATION TRACE (`Vendors.tsx` → `index`)
```tsx
const [rpp] = useState(() => localStorage['cbc.p2p.suppliers.perPage.v2'] in [10,200] ? n : 10);  // 688
useEffect(() => { debounce 500 ms; '' → immediate }, [search]);                                     // 782
api.get('/vendors', { params: { page, per_page: rpp, q, categories, compliance, scope: scopeTab, tab } });  // 805
setTotal(body.total); setFacets(body.facets);                                                        // 824
useEffect(() => setPage(1), [tab, debouncedSearch, scopeTab, catParam, compParam]);
// resize: fit = max(10, floor(avail / ROW)); if autoFitRef → setRpp(fit), keep first row visible   // 934
<WorklistPager total page pageSize={rpp} onPageSize={n => { autoFitRef.current = false; setRpp(n); setPage(1); }} pageSizeOptions={[10,25,50]} />
```
```php
// VendorController::index: facets computed from clone BEFORE categories/compliance → paginate(per_page ?: 24)
```

---

## 12. SUPPLIER ROW TRACE (`apiToVendor`, Vendors.tsx ~709)
```tsx
code: row.vendor_code ?? `S-${pad3(id)}`;  companyName: row.company_name ?? 'Untitled Supplier';
type: row.vendor_type?.name ?? 'Pending' → typeKind() pill colour;
state: state.name || state_code || '—';  stateCode: state_code || null (column hidden on international);
contacts: addresses.filter(named).sort(primary first) → first + "+N";
email: primary_address.email ?? primary_email ?? '—';   // href mailto: even for '—'
status: row.status === 'active' ? 'Active' : 'Inactive'; // not rendered
category → supplierCategory();  compliance_status → complianceTone();  product_mappings_count → badge
```

---

*Related documents: SUPPLIER_TECHNICAL_DOCUMENTATION.md · SUPPLIER_FUNCTIONAL_DOCUMENTATION.md · SUPPLIER_API_DOCUMENTATION.md*
