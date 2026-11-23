# P2P Service Management — Code Walkthrough

## 1. The file map

### Backend

| File | Role |
|---|---|
| `app/Http/Controllers/Api/P2p/ServiceController.php` | Every `/p2p/services` route — lookups, list, Stage 1, Stage 2, supplier rows, status |
| `app/Services/P2p/ServiceSupplierMapping.php` | Shared rules: read scope, edit denial, vendor card, pricing, Stage 2 completion, "does this supplier serve this service" |
| `app/Support/SupplierPricing.php` | Domestic / international arithmetic, caps, country → currency, default rate |
| `app/Support/MasterVisibility.php` | Tenant read scope and the tier-based edit denial |
| `app/Support/MasterBundleCache.php` | Cache key for the master bundle |
| `app/Models/P2p/Service.php` | Types, classifications, `TYPE_FIELDS`, option lists, relations |
| `app/Models/P2p/ServiceSupplier.php` | Mapping row, `STATUSES` |
| `app/Models/P2p/ServiceImage.php`, `ServiceAttachment.php` | File rows |
| `app/Models/Masters/ServiceCategory.php` | Category master (`master_service_categories`) |
| `app/Http/Controllers/Api/VendorController.php` | Supplier-side mapping: `serviceMappings`, `storeServices`, `updateServiceMapping`, `destroyServiceMapping` |
| `app/Http/Controllers/Api/P2p/P2pFileController.php` | `GET /p2p/files/download` for images and attachments |

### Frontend — `resources/js/pages/p2p/p2p-master-management/service-management/`

| File | Role |
|---|---|
| `ServiceManagement.tsx` | The list page — tabs, sub-tabs, search, columns, row actions, opens the modals |
| `ServiceTypeGate.tsx` | **Add Service** type / sub-type picker |
| `ServiceFormModal.tsx` | The two-stage form; per-type field groups (`SoftFields`, `OtherFields`, `MaterialFields`); validation; uploads; quick-add; Stage 2 panel |
| `ServiceSupplierModal.tsx` | `SupplierMapPanel` (the mapped list) and the Map Supplier flow (Domestic / International chooser → form) |
| `ServiceGstModal.tsx` | GST % list — map to the service, add, remove |
| `serviceApi.ts` | Every API call and the API ⇄ screen shape conversion |
| `serviceData.ts` | Types, `SVC_TYPES`, labels, placeholders, supplier price helpers |
| `serviceLoading.tsx` | Shimmer rows for the list and the supplier table |
| `serviceIcons.tsx` | Inline SVG icons |
| `service-management.css` / `service-form.css` / `service-suppliers.css` | Styles for the list, the form, the supplier popup |

Shared components used: `WorklistPager`, `Tooltip`, `MasterSelect`,
`MasterRecordModal` (`variant="teal"`), CLM `SegmentModal`, `AttachPicker` +
`CameraCaptureModal` (Take photo), `ConfirmContext`.

### Routes

```php
// routes/api.php — inside auth:sanctum, user.active, tenant
Route::prefix('p2p/services')->group(function () {
    $svc = \App\Http\Controllers\Api\P2p\ServiceController::class;
    Route::get   ('/master-bundle',               [$svc, 'masterBundle']);
    Route::get   ('/supplier-pool',               [$svc, 'supplierPool']);
    Route::get   ('/stats',                       [$svc, 'stats']);
    Route::get   ('/next-code',                   [$svc, 'nextCodePreview']);
    Route::get   ('/',                            [$svc, 'index']);
    Route::post  ('/step/core',                   [$svc, 'storeCore']);
    Route::get   ('/{id}',                        [$svc, 'show']);
    Route::put   ('/{id}/step/suppliers',         [$svc, 'storeSuppliers']);
    Route::get   ('/{id}/suppliers',              [$svc, 'suppliers']);
    Route::post  ('/{id}/suppliers',              [$svc, 'storeSupplier']);
    Route::patch ('/{id}/suppliers/{map}',        [$svc, 'updateSupplier']);
    Route::patch ('/{id}/suppliers/{map}/status', [$svc, 'updateSupplierStatus']);
    Route::patch ('/{id}/status',                 [$svc, 'updateStatus']);
});
```

Frontend route: `/p2p/service-management` → `ServiceManagement` (lazy, in
`components/App.tsx`); menu id `p2p.service` in `constants.ts`; route guard in
`utils/routeAccess.ts`.

---

## 2. Request flow — create a service (Stage 1)

```
ServiceTypeGate  ──onChoose(kind, otype)──►  ServiceManagement.chooseType
   GET /p2p/services/next-code  → shown in the form header (preview)
ServiceFormModal.goNext
   validate()                    ← REQUIRED[kind], name rules, haz class
   no gstRateId?  → "GST is mandatory" + open ServiceGstModal
   saveServiceCore()  (serviceApi.ts) → FormData
POST /p2p/services/step/core
   normaliseCoreInput()          '' → null, \r\n → \n, contract flag parse
   id?  findService (404) → editDenial (403)
   validateCore()                type-specific rules, active masters,
                                 category ∈ type (+ classification),
                                 gst_percentage from the master
   self & no primary image kept → 422
   DB::transaction
      new → pg_advisory_xact_lock(client:branch) → nextCode → draft
      null fields the type does not own
      fill + save (step_completed ≥ 1)
      gst changed → repriceDomesticSuppliers()
      syncImages() · syncAttachments()
   ← detail()   (201 new / 200 update)
goNext → setStage(2)
```

The field-error mapping on the way back:

```ts
// ServiceFormModal.tsx
Object.entries(apiErrors).forEach(([k, msgs]) => {
  const base = API_FIELD[k.split('.')[0]];          // attachment_files.0 → att
  const field = base === 'provider' ? brandKey : base; // make vs provider
  if (field && msgs?.[0]) next[field] = msgs[0];
});
```

`API_FIELD` maps every API field name to the form key, so a server-side 422
lands on the right input instead of only in a toast.

---

## 3. Inside `storeCore()` — the type switch

```php
$owned = Service::TYPE_FIELDS[$data['service_type']];
foreach (Service::SWITCHABLE_FIELDS as $col) {
    if (! in_array($col, $owned, true)) {
        $data[$col] = $col === 'contract_required' ? false : null;
    }
}
if (($data['haz_type'] ?? null) !== 'Hazardous') {
    $data['haz_class_id'] = null;
}
```

Every save writes the **whole** set of switchable columns, so the row always
matches its type. `fill()` is then restricted to `$fillable` minus the
server-owned columns:

```php
$service->fill(collect($data)->only((new Service)->getFillable())
    ->except(['client_id', 'branch_id', 'created_by', 'code', 'status'])->all());
```

### Images

```php
$remove = $service->service_type === Service::TYPE_SELF
    ? $service->images()->whereIn('id', (array) $request->input('remove_image_ids', []))->get()
    : $service->images()->get();          // not Self-Consumable: no images at all
if ($service->service_type === Service::TYPE_SELF && $request->hasFile('primary_image_file')) {
    $remove = $remove->merge($service->images()->where('is_primary', true)->get())->unique('id');
}
```

Files are stored at `{dir}/{8 random hex}/{sanitised name}` — the random folder
keeps two uploads of `photo.jpg` from overwriting each other.

---

## 4. Request flow — map a supplier (Stage 2 / popup)

```
SupplierMapPanel  "Map Supplier"
   loadSupplierPool(bucket)  GET /supplier-pool?service_type=&classification=  (pages of 100)
   chooser: Domestic (n) / International (n)
   form: supplier → auto-fill code/type/location/contact
         price (+ currency, rate)  → client-side caps
   onChange([...suppliers, row])
ServiceFormModal.mapSuppliers / ServiceManagement.saveMap
   syncServiceSuppliers(): unmap removed → POST each new → refetch
POST /p2p/services/{id}/suppliers
   findService · editDenial · validate · assertVendorsVisible
   already active → 422
   priceFields()  ── ServiceSupplierMapping
        vendor card → origin from address country
        origin mismatch → 422
        international: currency ≠ INR, rate (default from master), assertFits
        domestic: service gst_id required & must match, domesticAmounts, assertFits
   DB::transaction: reuse inactive row or create · completeStageTwo()
```

`Submit Service` then calls `PUT /{id}/step/suppliers` with the full list,
which upserts them, deactivates any other active mapping, and sets the service
`active` / Stage 2.

---

## 5. Inside `priceFields()` — the heart of the mapping

```php
$origin = $in['origin'] ?? $card['origin'];

if ($origin !== $card['origin']) {
    throw ValidationException::withMessages([$prefix.'origin' => [
        $origin === SupplierPricing::INTERNATIONAL
            ? 'This supplier is based in India — map it as a Domestic supplier.'
            : 'This supplier is based in '.($card['country'] ?: 'another country').' — map it as an International supplier.',
    ]]);
}
```

The `$prefix` (`suppliers.3.`, `mappings.0.`) is threaded through every message
so a bulk write reports the failing row, not just the field.

`domesticAmounts()` always prices with **the service's** `gst_percentage` and
returns `gst_id = $service->gst_id` — the supplier never carries its own rate.

---

## 6. Inside `index()` — the list

```php
$query = $this->scoped($request, true)          // tenant + branch switcher
    ->with([... 'activeSuppliers.vendor:id,vendor_code,company_name'])
    ->withCount(['activeSuppliers as suppliers_count']);
// service_type, classification, then applyRowFilters(): status, supplier, q
$page = $query->paginate((int) $request->query('per_page', 10));
return response()->json($page->toArray() + ['counts' => $this->tabCounts($request)]);
```

`tabCounts()` runs the **same** row filters (minus type / classification) as a
single `GROUP BY service_type, classification`, so the badges follow the
search. The frontend reads them straight into the tab and sub-tab badges.

---

## 7. Frontend flow

### List (`ServiceManagement.tsx`)

- State: `tab`, `subs[tab]`, `query` (debounced), `page`, `pageSize`, `reloadKey`.
- One effect fetches with an `AbortController`, so fast tab / search changes
  never render a stale response.
- `COLUMNS[tab]` defines the per-tab columns and widths; `renderCell()` draws
  each one. `clip()` / `clipBadge()` clamp text to two lines with a tooltip.
- `bucketOf(record)` hands the row's type / classification to the supplier
  popup, which narrows the pool.
- `toggleActive()` confirms, then `PATCH /{id}/status`, then reloads.

### Form (`ServiceFormModal.tsx`)

- `input.loading` shows the shimmer while the detail / next code loads; the
  form is **remounted** with `instant: true` when data arrives, which skips the
  pop-in animation (that was the blink).
- `REQUIRED[kind]` drives the required check; `NAME_MAX` 150, `BRAND_MAX` 255,
  `DESC_MAX` 10,000, `NOTE_MAX` 2,000; `HAS_LETTER = /\p{L}/u`.
- Uploads: `IMG_EXT` jpg/jpeg/png ≤ 2 MB, up to 10 secondary; `ATT_EXT`
  pdf/jpg/jpeg/png ≤ 10 MB, one file. Both offer **Upload file / Take photo**
  through `AttachPicker`.
- Escape closes the form only when no inner layer (camera, attach menu,
  quick-add) is open.
- `gstLocked = domesticCount > 0 && vals.gstPct != null`.

### Supplier popup (`ServiceSupplierModal.tsx`)

- Pools load once per bucket and are split into domestic / international by the
  card's `origin`.
- Closing the Add / Edit Supplier wizard clears the vendor cache
  (`refreshVendors`), so a supplier just created or edited appears at once.
- Client caps mirror the API: `MAX_PRICE = 9999999999.99`,
  `MAX_RATE = 99999.9999`.

---

## 8. Patterns you will see in this code

| Pattern | Why |
|---|---|
| `findService()` through `scoped()` | A service outside the tenant is a 404, never a leak |
| `editDenial()` before every write | One place decides who may change a row |
| Mapping rows deactivated, not deleted | The unique `(service_id, vendor_id)` pair and history |
| `withTrashed()` in `nextCode()` | Codes are never reused |
| Prefix-threaded validation messages | Bulk writes point at the failing row |
| `body:has(.svm-page)` CSS selectors | Shared components (popups, camera, MasterSelect menus) restyled for this page only |
| `instant` remount | Data arriving after the shimmer does not replay the open animation |

---

## 9. Symptom → file

| Symptom | Look in |
|---|---|
| Wrong / missing tab count | `ServiceController::tabCounts`, `applyRowFilters` |
| Search misses a field | `ServiceController::applyRowFilters` |
| Column cut off / not truncating | `ServiceManagement.tsx` `COLUMNS`, `clip`; `service-management.css` `.svm-clamp` |
| Page scrolls instead of the table / gap above footer | `service-management.css` (`.tvc-list`, the short-screen media rule) |
| 422 on Save & Next shows only as a toast | `ServiceFormModal.tsx` `API_FIELD` |
| "A primary image is required…" | `ServiceController::storeCore` |
| Category not offered | `serviceApi.ts` `loadServiceCategories`; category's `service_type` / `classification` |
| New master not in the dropdown | Inactive record, or the 5-minute bundle cache (`masterBundle`) |
| Map Supplier dropdown empty | Supplier Types not classified — `supplierPool`, `VENDOR_TYPE_BY_NAME` |
| Supplier edited but popup shows old data | `ServiceSupplierModal.tsx` `refreshVendors` |
| Domestic / International refused | `ServiceSupplierMapping::priceFields`, supplier's primary address country |
| GST button locked | `ServiceFormModal.tsx` `gstLocked` |
| Domestic totals changed after a GST edit | `ServiceController::repriceDomesticSuppliers` |
| Can't activate | `ServiceController::updateStatus` (`step_completed < 2`) |
| 403 on edit | `ServiceSupplierMapping::serviceEditDenial` → `MasterVisibility::hierarchicalDenial` |
| File won't open / 403 on download | `P2pFileController::download` |
| Duplicate code | `ServiceController::nextCode` + the advisory lock in `storeCore` |
| Form blinks when opening | `ServiceFormModal.tsx` `instant`, `service-form.css` `.svf-backdrop.is-instant` |
| Camera popup colours | `service-form.css` (`body:has(.svm-page) .cam-card…`) |
