# P2P SOURCING MANAGEMENT TRACKER

## Technical Documentation

**Module:** P2P Sourcing Management Tracker  
**Menu Path:** Procure to Pay (P2P) → Procurement Management → Sourcing Management Tracker  
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

This document explains **how the Sourcing Management Tracker is built**: the
architecture, the database, the business rules in the code, security, and how
the frontend is organised. It is written for developers who will maintain or
extend the module.

### 1.2 Related Documents

| Document | Use it for |
|---|---|
| Functional Documentation | What the module does for the user |
| Code Walkthrough | Step-by-step screen → API → database flow for every feature |
| API Documentation | Every endpoint with request and response |

### 1.3 Conventions

* **BE** = `app/Http/Controllers/Api/P2p/SourcingController.php`
* **FE** = `resources/js/pages/p2p/procurement-management/sourcing-tracker/`
* Code is referenced by **function / component / constant name** (e.g.
  `BE::mapSupplier()`, `AssignTargetModal.tsx priceBad()`), not line numbers —
  lines change with every edit (backend comments were removed on 23-Nov-2026).
* Table short names in Section 12: **T** = `p2p_sourcing_targets`, **P** =
  `p2p_sourcing_products`, **M** = `p2p_sourcing_product_suppliers`, **D** =
  `p2p_suppliers`.
* Verified against the code up to commit `6170fa175` (typing caps via
  `limitNum`, Map Supplier dropdown widths), which includes `bf7dad2ed` (all
  departments, self-assign, Convert links early, Converted badge).

---

## 2. TECHNOLOGY STACK

| Layer | Technology |
|---|---|
| Backend | PHP 8.2, Laravel 12 |
| Database | PostgreSQL |
| Authentication | Sanctum + `user.active` + `tenant` middleware (the main authenticated group in `routes/api.php`). No permission middleware, no throttle |
| Frontend | React 19 + TypeScript, built with Vite |
| HTTP client | Axios (`resources/js/api`) |
| File storage | Laravel `public` disk: `p2p/{clarity\|supplier-cards}/c{client_id}/{random24}/{name}.{ext}` |
| Queue / jobs | None |
| Cache | Only `formMasters.ts` (a module-level promise for `/p2p/form-masters`) |
| State management | Plain React state — no global store, no React Query |

---

## 3. SYSTEM ARCHITECTURE

### 3.1 Layer Diagram

```
React  sourcing-tracker/
  SourcingTracker.tsx           the list; lazy-loads every popup
  ├─ AssignTargetModal          create / edit a target
  │    ├─ ClarityDialog  → AttachPicker (→ CameraCaptureModal), AttachedFiles
  │    └─ ClarityNoteView
  ├─ ProductList                read-only (useTargetReport)
  ├─ SourcingTargetReport       (useTargetReport, ClarityChip)
  │    └─ MappedSuppliers       supplier cards
  ├─ MapSupplierModal           Master / New → Domestic / International
  │    ├─ SupplierTypeChooser
  │    ├─ SupplierMasterForm    (+ lazy AddVendorModal for "+")
  │    └─ NewSupplierForm
  └─ AddVendorModal             Convert to Supplier (Supplier Management's wizard)
       │  axios
       ▼
routes/api.php  /p2p/...        auth:sanctum · user.active · tenant
       ▼
SourcingController              lists, targets, report, mapping, pricing, upload, convert
       ▼
SupplierPricing                 domestic / international price arithmetic
MasterVisibility                master read scope;  Vendor::scopeForUser for vendors
       ▼
p2p_sourcing_targets → p2p_sourcing_products → p2p_sourcing_product_suppliers
                                                    ├─ vendors        (source = master)
                                                    └─ p2p_suppliers  (source = new)
```

### 3.2 Which Component Calls Which API

| Component | Calls |
|---|---|
| `SourcingTracker` | `GET /p2p/sourcing-targets?tab&page&per_page&q` · Convert: `GET` then `POST /p2p/new-suppliers/{id}/convert` |
| `AssignTargetModal` | `GET /p2p/products` · `GET /p2p/team-members` (Add) · `GET …/next-code` · `GET …/{code}` (Edit) · `POST /p2p/upload` (clarity) · `POST` / `PUT /p2p/sourcing-targets[/{code}]` |
| `SourcingTargetReport` | `GET …/{code}/report` · clarity via `ClarityChip` → `viewDocument()`: `GET /p2p/clarity/download?path=` |
| `ProductList` | `GET …/{code}/report` only (no clarity column) |
| `MappedSuppliers` | `GET …/products/{id}/suppliers` |
| `MapSupplierModal` | `GET /p2p/suppliers` (counts per origin) · `POST /p2p/upload` (card) · `POST …/suppliers` · `PUT …/suppliers/{m}` · `PATCH …/suppliers/{m}/price` |
| `SupplierMasterForm` | `GET /p2p/suppliers?origin=` · `GET …/products/{id}/suppliers` (to disable mapped ones) |
| `NewSupplierForm`, `SupplierMasterForm` | `GET /p2p/form-masters` (cached) |
| `AddVendorModal` (Convert) | Supplier Management's own endpoints; its Contacts step (`POST /vendors/{id}/step/contacts` with `_method=PUT`) sends `convert_supplier_id` — this is where the New Supplier is linked (Section 7.9) |

---

## 4. PROJECT FILE STRUCTURE

### 4.1 Backend

| File | Responsibility |
|---|---|
| `app/Http/Controllers/Api/P2p/SourcingController.php` | Every Sourcing endpoint |
| `app/Http/Controllers/Api/VendorController.php` → `storeContacts()` | Supplier wizard Contacts step; performs the Convert **link** |
| `app/Support/SupplierPricing.php` | Price arithmetic, caps, `vsTarget()`, `assertFits()` |
| `app/Models/P2p/SourcingTarget.php` · `SourcingProduct.php` · `SourcingProductSupplier.php` · `Supplier.php` | The four tables |
| `app/Support/Concerns/EnforcesUniqueEmail.php` · `app/Support/EmailGuard.php` · `config/email_uniqueness.php` | System-wide unique email |
| `app/Support/MasterVisibility.php` · `app/Models/Vendor.php` | Read scopes; `Vendor::scopeForUser`, `$convertingSupplierId`, `sameEmailOwnerRows()` |
| `app/Console/Commands/BackfillSourcingProductNames.php` | `php artisan sourcing:backfill-product-names [--apply]` — repairs products saved with an unknown code |

### 4.2 Frontend

| Group | Files |
|---|---|
| Page | `SourcingTracker.tsx` |
| Popups | `AssignTargetModal.tsx`, `SourcingTargetReport.tsx`, `ProductList.tsx`, `MappedSuppliers.tsx`, `MapSupplierModal.tsx`, `ClarityDialog.tsx`, `ClarityNoteView.tsx` |
| Forms / pieces | `SupplierTypeChooser.tsx`, `SupplierMasterForm.tsx`, `NewSupplierForm.tsx`, `ClarityChip.tsx`, `AttachPicker.tsx`, `AttachedFiles.tsx`, `ClipText.tsx`, `icons.tsx` |
| Helpers | `data.ts`, `targetProducts.ts`, `formMasters.ts`, `popupHooks.ts`, `useSaveGuard.ts`, `upload.ts`, `apiError.ts`, `format.ts`, `currency.ts` |
| CSS | `sourcing-tracker.css`, `assign-target-modal.css`, `popup-shell.css`, `attach-picker.css`, `attached-files.css`, `sourcing-target-report.css`, `product-list.css`, `mapped-suppliers.css`, `map-supplier-modal.css`, `supplier-master-form.css` |

The full File | Responsibility list is in the Code Walkthrough, Section 2.

---

## 5. API ROUTES

All in `routes/api.php`, one block inside the authenticated group (search for
`P2p\SourcingController`). `{target}` is the **code** (`ST-001`); `{product}`
and `{supplier}` are numeric.

| Method | URI | Controller method | Purpose |
|---|---|---|---|
| GET | `/p2p/products` | `products` | Product Master picker (branch-scoped) |
| GET | `/p2p/team-members` | `teamMembers` | Who can be assigned |
| GET | `/p2p/suppliers` | `suppliers` | Supplier Master pool, `?origin=` |
| GET | `/p2p/new-suppliers` | `newSuppliers` | New Supplier directory (no FE caller) |
| GET | `/p2p/new-suppliers/{s}/sourcings` | `supplierSourcings` | Where a New Supplier is mapped (no FE caller) |
| GET / POST | `/p2p/new-suppliers/{s}/convert` | `convertPrefill` / `convertSupplier` | Convert to Supplier |
| GET | `/p2p/form-masters` | `formMasters` | Segments, countries, states, state codes, GST, currencies, home state |
| POST | `/p2p/upload` | `upload` | A clarity file or business card |
| GET | `/p2p/clarity/download` | `downloadClarity` | Tenant-checked clarity download |
| GET | `/p2p/sourcing-targets` | `index` | The list (`tab` mode) |
| GET | `/p2p/sourcing-targets/next-code` | `nextCode` | Preview of the next code |
| POST | `/p2p/sourcing-targets` | `store` | Create |
| GET | `/p2p/sourcing-targets/{target}` | `show` | Edit payload |
| PUT | `/p2p/sourcing-targets/{target}` | `update` | Edit (creator) |
| GET | `…/{target}/report` | `report` | Report products |
| PATCH | `…/products/{p}/status` | `setProductStatus` | Set Completed / In Progress (no FE caller) |
| PUT | `…/products/{p}/clarity` | `updateProductClarity` | Replace clarity (Bulk Sourcing only) |
| GET / POST | `…/products/{p}/suppliers` | `mappedSuppliers` / `mapSupplier` | List / map |
| PUT | `…/suppliers/{m}` | `updateSupplier` | Edit a New Supplier mapping (+ its directory entry) |
| PATCH | `…/suppliers/{m}/price` | `updateSupplierPrice` | Re-quote any mapping |
| PUT | `/vendors/{id}/step/contacts` | `VendorController::storeContacts` | Supplier wizard step; accepts `convert_supplier_id` (the Convert link) |

---

## 6. DATA MODEL

### 6.1 Relationships

```
clients
  └─ p2p_sourcing_targets (client_id)                 one target
       └─ p2p_sourcing_products (sourcing_target_id)  many products   [FK, cascade]
            └─ p2p_sourcing_product_suppliers         many mappings   [FK, cascade]
                  supplier_id → vendors.id        when source = master   (no FK)
                  supplier_id → p2p_suppliers.id  when source = new      (no FK)

p2p_suppliers.converted_vendor_id → vendors.id   (set by Convert)
```

### 6.2 `p2p_sourcing_targets` — the target

| Column | Notes |
|---|---|
| `client_id` (FK), `branch_id` | Tenant and branch of the creator |
| `code` | `ST-001` … Index on (`client_id`, `code`) is **not unique** |
| `source` | `master` \| `manual` |
| `start_date`, `due_date` | Start = server's today on create; due = Sourcing TAT |
| `assignee_id`, `assignee_name` | Name is a snapshot of `users.name` |
| `created_by`, `created_by_name` | Snapshot |
| `status` | Default *In Progress*; **never updated** (progress is computed) |
| Soft deletes | Yes |

### 6.3 `p2p_sourcing_products` — products of a target

| Column | Notes |
|---|---|
| `sourcing_target_id` (FK, cascade) | No `client_id` — tenancy through the target |
| `source` | `master` \| `manual` |
| `product_id`, `code`, `name`, `segment`, `hsn` | Snapshot from the Product Master. `segment` is **`string(128)`** |
| `target_price` | **String**, as typed (e.g. `"18,500"`) |
| `clarity_type` | `text` \| `link` \| `pdf` (`string(16)`) |
| `clarity_value` | `text` — the note, the URL, or a file path (older data: paths joined by newlines) |
| `status` | *In Progress* \| *Completed* |
| Soft deletes | Yes |

### 6.4 `p2p_sourcing_product_suppliers` — a mapping

| Column group | Columns |
|---|---|
| Keys | `sourcing_product_id` (FK, cascade), `supplier_id`, `source` (`master` \| `new`) |
| Contact snapshot | `name`, `segment` (512), `contact`, `mobile`, `email`, `gmaps`, `address`, `country`, `state`, `state_code`, `city`, `card_path` |
| Pricing | `origin`, `currency_code`, `price`, `gst_percentage`, `gst_type` (`intra` \| `inter` \| `none`), `cgst_amount`, `sgst_amount`, `igst_amount`, `gst_amount`, `total_amount`, `exchange_rate`, `inr_amount`, `price_valid_till` |
| Audit | `mapped_by` |
| Notes | Soft deletes. **No unique key** — duplicates are prevented in code. `supplier_id` has no FK and no Eloquent relation |

### 6.5 `p2p_suppliers` — the New Supplier directory

| Column | Notes |
|---|---|
| `client_id`, `branch_id` | Tenant |
| `name`, `segment` (512), contact fields, `card_path`, `origin` | As typed when first mapped |
| `converted_vendor_id`, `converted_at`, `converted_by` | Set by Convert |
| Rules | Soft deletes. **No unique key on name**. Email unique **system-wide** (together with `vendors.primary_email`) through `EnforcesUniqueEmail` |

### 6.6 Migrations and Legacy

| Item | Note |
|---|---|
| `2026_06_23_000020` | Created `p2p_sourcing_products` — `segment` is still `string(128)` |
| `2026_06_24_000010_widen_p2p_segment_columns` | Widened `p2p_suppliers.segment` and `p2p_sourcing_product_suppliers.segment` to **512** (matches the `new_supplier.segment` rule) |
| `2026_11_19_100200` | Renamed old `SRC-` codes to `ST-` |
| `2026_06_23_000001` | Legacy tables `sourcing_targets` / `sourcing_target_products` — **unused** |
| Tenancy | No model uses `BelongsToTenant`; tenancy is a hand-written `client_id` filter (`target()`, `index`, the `p2p_suppliers` queries) |

---

## 7. BUSINESS LOGIC

### 7.1 Target Code Allocation — `ST-NNN`

```php
// BE::store()
DB::transaction(function () {
    DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
    $seq  = SourcingTarget::withTrashed()->where('client_id', $user->client_id)->count() + 1;
    $code = sprintf('ST-%03d', $seq);
    // …
});
```

| Rule | Detail |
|---|---|
| Scope | Per client |
| Reuse | Soft-deleted targets are counted, so codes are not reused |
| Preview | `nextCode()` runs the same count **without** the lock |
| Risk | It is a **count, not a max**, and `code` has **no unique constraint** — a hard delete or manual insert can make a duplicate; `target()` then uses `first()` |

### 7.2 The List — `index()` → `trackerList()`

| Step | Implementation |
|---|---|
| Load | **All** the client's targets, `latest()`, with products (`id, status, source, name`) and `withCount('suppliers')` |
| Tab | In **PHP**: `created` = created by you · `assigned` = assigned to you · `all` = both, de-duplicated, id desc |
| Validation | `tab` all \| created \| assigned · `q` ≤ 100 · `status` In Progress \| Completed \| Overdue · `per_page` 1–200 (default 10) |
| Search | Lower-cased `str_contains` over code, source labels, creator, assignee, progress status, *overdue*, product names, due date as `Y-m-d` and `d/m/Y`. Start date not included |
| Paging | In PHP; `page` clamped to the last page |
| Counts | `{all, created, assigned}`, independent of `q` |
| Legacy | Without `tab` the endpoint returns the older `{assigned:[], created:[]}` shape (Bulk Sourcing) |

**Computed per row on the server (`row()`):** source labels, completed count,
`progress = round(done × 100 / total)`, `overdue = !complete && due_date
end-of-day is past` (server time zone), `mappedSuppliers`, first product.

**Computed in the browser (`data.ts`):** `progressOf()`, `tatState()` — at risk
= due within 7 days by the **browser's** date; overdue uses the server flag.

**Browser fetch (`SourcingTracker.tsx`, list `useEffect`):**

| Mechanism | Purpose |
|---|---|
| 300 ms debounce (`SEARCH_DEBOUNCE_MS`) + 120 ms coalescing | One request per pause in typing |
| `reqSeq` | Drops a stale reply |
| `lastServed` | Skips a refetch when a bigger page already holds every row |
| `shownFor` (CS-2215) | Same `tab\|q\|reloadKey\|page` and rows showing → no shimmer; rows replaced in place |

### 7.3 Create and Edit a Target

**Validation — `validatePayload()`**

| Field | Rule |
|---|---|
| `due_date` | required date; **today or later on create only** |
| `source` | master \| manual |
| `assignee_id` | required |
| `products` | array, at least 1 |
| `products.*.id` | `nullable\|integer` — a kept product on Edit |
| `products.*.from` | master \| manual |
| `products.*.code` | required for master |
| `products.*.name` | required for manual |
| `products.*.target_price` | `^\d[\d,]*(\.\d{1,2})?$`, ≤ 64 chars; required for manual only; **no numeric cap** |
| `products.*.clarity.type` / `.val` | text \| link \| pdf / string |

**Browser is stricter** for every row: typing goes through `limitNum()`
(`PRICE_INT` 10 / `PRICE_DEC` 2), and on save `priceBad()` requires > 0, ≤
`MAX_TARGET_PRICE` (9,999,999,999.99 = `SupplierPricing::MAX_PRICE`),
`^\d+(\.\d{1,2})?$`, ≤ 64 chars. A bad row is marked and focused
(`goToFirstError()`) and nothing is sent. A server 422 `products.N.target_price`
is mapped back to row N (`serverPriceKeys`).

**`store()`**

1. `assigneeAllowed()` — same client, active, not super admin. **Self-assign is allowed** (`bf7dad2ed`).
2. Transaction + client lock → code → target (`start_date` = today).
3. `syncProducts()` — a master product is matched by code in the same branch, then any branch, then by padded code (same branch, then **all** client products in memory). Name, segment and HSN are **snapshotted**. An **unknown code is accepted** (`product_id` null, name = code).

There is **no delete** for a target (no route, method or UI).

**`update()`**

1. **Creator only** (403).
2. Refuses (422) to drop a product that has suppliers.
3. **View-only** when `assigneeIsActive()` is false → 403.
4. Transaction: `source`, `due_date`; kept products → target price, clarity, name (manual); new products → `syncProducts()`; removed → soft-delete their suppliers, then the product.

| Rule | Effect |
|---|---|
| A product `id` of another target | Treated as **new** |
| A kept product's `target_price` / `clarity` left out | **Cleared** — always send the full row |
| Assignee, start date | Can't change; past-date check skipped on Edit |
| `show()` | Returns `masterRows` / `manualRows` with `mapped`, and `assigneeActive`; `productDisplayResolver()` shows **live** Product Master name / segment / HSN |

### 7.4 The Assignee List — `teamMembers()`

| Part | Rule |
|---|---|
| Eligible employees | `employees` of the client (soft-deleted excluded), **any department**, active, `onboarding_stage_completed ≥ 6`, with a `user_id`. The employee's own branch is not checked |
| Users returned | `users` of the client that are (an eligible employee's user **or** a branch user **or** the caller), active, `users.branch_id` = caller's branch (`?branch_id` only when the caller has none), not super admin, ordered by name |
| Row | `{id, name, code (emp_code), department, role}` — department = employee's department, else *Branch Admin* for a branch user, else null; role = designation, else `users.designation`, else the user type |
| FE | `memberOptions`: violet list-only department badge; the caller's row marked *"(You)"*; nothing disabled |
| Re-check on save | `assigneeAllowed()` only — does **not** re-check branch or onboarding |

### 7.5 Clarity Files

1. On **Save**, the form uploads each product's new file (**one per product**) to `POST /p2p/upload` (`kind=clarity`).
2. The returned `/storage/…` path goes into `products[].clarity.val`.
3. Then the target is saved.

Newline-joined multi-path values exist only in older / Bulk Sourcing data. Files
uploaded before a failed save are never cleaned up.

### 7.6 Mapping a Supplier — `mapSupplier()`

| Part | Rule |
|---|---|
| Who | `canMapSuppliers()` — assignee, creator, super admin |
| Validation | `price` > 0, ≤ 9,999,999,999.99 · `gst_percentage` 0–100 · `gst_type` intra \| inter · `currency` 3 letters · `exchange_rate` > 0, ≤ 99,999.9999 · `valid_till` today or later |
| **Master** (`supplier_id`) | Vendor via `Vendor::forUser` (else 404). 422 *already mapped* if the product has a `source=master` row for this vendor **or** (CS-2308) a `source=new` row whose directory entry has `converted_vendor_id` = this vendor. Country / state / state code from the **first address** (`Vendor::addresses()` is ordered `is_primary` desc, then id). Snapshot: name, segment, contact, mobile, email, country, state, state code, city — not gmaps, address or card |
| **New** (`new_supplier`) | Origin must match the country (domestic ⇒ India). Directory entry found by **`LOWER(name)`** in the client, else created — an existing entry is **not updated**. Converted entry → 422 (*map it from Supplier Master*). Already mapped → 422 |
| After | Product `status` → **Completed** |

**No transaction** around "create directory entry" + "create mapping". An orphan
entry is rare: pricing / origin errors are raised first, a duplicate email
throws inside `P2pSupplier::create` (nothing written), and a just-created entry
can't be converted or already mapped. Only a failure of the mapping insert
itself leaves an orphan.

### 7.7 Pricing — `sourcingPrice()` + `SupplierPricing`

| | Domestic | International |
|---|---|---|
| Origin check | country = India | country ≠ India |
| Currency | INR | Sent, or by country (default USD); **INR refused** |
| Rate | — | Sent, or the Currency master's rate |
| GST type | Sent, or `gstTypeFor()`: **intra** when the supplier's state code (or name) equals the **user's branch** home state, else **inter** | `none` |
| GST % | Default 18 | 0 |
| Amounts | intra: CGST = round(GST ÷ 2), SGST = GST − CGST · `total = price + GST` · `inr_amount = total` | `total = price` · `inr_amount = price × rate` |
| Cap | Total / INR ≤ 999,999,999,999.99 (`assertFits()`) | Same |
| FE typing cap | Price `limitNum(v, 10, 2)` | Price as Domestic; rate `limitNum(v, 5, 4)` |

* With the typing caps, `price.max` / `exchange_rate.max` can't be hit from the screens; `assertFits()` only from International (price × rate up to ~10¹⁵).
* The New Supplier form always sends `gst_type` (used as sent); the Supplier Master form never does, so `gstTypeFor()` decides — codes when both known, else names, against the user's branch (`homeState()` → `branches.state`, `branches.gst_state_code`; no branch → *inter*).
* **vs Target** (`mappedRow()`): domestic compares the **ex-GST price**, international the **INR amount**, with the target price (commas removed).

**Flags on each mapped row (`mappedRow()`):**

| Flag | Rule |
|---|---|
| `canConvert` | `source=new` and the directory entry has no `converted_vendor_id` |
| `converted` | `source=master` and the vendor id is some client `p2p_suppliers.converted_vendor_id` (the *Converted* badge) |

`updateSupplierPrice()` calls `mappedRow()` without the converted-vendor list, so
its response always has `converted: false`.

### 7.8 Editing a Mapping

| Endpoint | Behaviour |
|---|---|
| `PATCH …/suppliers/{m}/price` | Any mapping. Keeps the origin; re-prices with the stored country / state; **overwrites `mapped_by`**; a `valid_till` left out is cleared |
| `PUT …/suppliers/{m}` | New Supplier mappings only. Country must match the origin; re-prices only if `price` is sent; updates the mapping **and** the directory entry (query-builder `update()` — **skips the unique-email check**) |

### 7.9 Convert to Supplier

**Sequence**

```
convertPrefill()  →  wizard identity step creates the vendor
                  →  wizard Contacts step: storeContacts() + convert_supplier_id  ══► LINK
                  →  wizard KYC → finish
                  →  convertSupplier()  (confirm + copyBusinessCard)
```

| Step | Logic |
|---|---|
| `convertPrefill()` | The directory entry in the wizard's shape; country / state / segment ids by case-insensitive name; international ⇒ `gst_applicable = No`. Returns `business_card`, but `startConvert()` passes only `origin`, `identity`, `address` — the card reaches the vendor only through `copyBusinessCard()` |
| Identity step | `POST /vendors/step/identity` creates the vendor |
| **Contacts step — the link** (`VendorController::storeContacts()`) | Vendor via `Vendor::forUser()->findOrFail` (404; `hierarchicalDenial()` returns null for every `Vendor`). (1) New Supplier must be in the client and not converted into a **different** vendor, else 422 `errors.convert_supplier_id` *This New Supplier cannot be converted into this supplier.* (2) `Vendor::$convertingSupplierId` exempts its email via `sameEmailOwnerRows()`. (3) If not yet linked: a second transaction moves / merges the mappings and stamps `converted_vendor_id`, `converted_at`, `converted_by`. No card copy. Re-saving for the same vendor skips the link |
| `convertSupplier()` | `vendor_id` must be a vendor of the **same client** (`Vendor::where('client_id', …)`); 422 if converted to another vendor. Transaction: each remaining `source=new` row **merges** (product already has the vendor as Master → soft-delete) or **moves** (`source = master`, `supplier_id = vendor`, `name` = vendor name; the old contact / email / mobile / card snapshot is **kept**). Stamps `converted_*` again. Then `copyBusinessCard()` if the vendor's primary contact has no attachment. `mappings_moved` / `mappings_merged` are normally **0** here |
| Access | Company only — no creator / assignee check; the button shows to anyone who can open the report. Unknown ids → 404 |

---

## 8. SECURITY AND ACCESS CONTROL

### 8.1 Middleware

Every route: `auth:sanctum` → `user.active` → `tenant`. There is no
module-permission check on the server.

### 8.2 Server Access Helpers

| Helper | Rule | Used by |
|---|---|---|
| `viewDenial()` | super admin, client admin, creator or assignee | show, report, mappedSuppliers, setProductStatus, updateProductClarity |
| Inline in `update()` | creator only | update |
| `canMapSuppliers()` | assignee, creator, **super admin** (not client admin) | mapSupplier, updateSupplier, updateSupplierPrice |
| `assigneeAllowed()` | same client, active, not super admin (creator included) | store |
| `assigneeIsActive()` | user active and linked employee active | update (view-only), show |
| *(none)* | company only | convertPrefill, convertSupplier, newSuppliers, supplierSourcings |
| `VendorController::storeContacts()` | vendor visible via `Vendor::forUser()` (404); New Supplier checked by company only | the Convert link |

### 8.3 Frontend Gates

| Gate | Rule |
|---|---|
| Route | `utils/routeAccess.ts` `canAccessPath()` → `isBiz && leaf('p2p.sourcing_tracker')`: a branch user or employee **with** `can_view` (branch users need it too); super admin / client admin not let in |
| Edit pencil | `canEdit = createdById === me` |
| Map / Edit supplier | `canMap = assignee or creator` |
| Not used | `can_add` / `can_edit` of `p2p.sourcing_tracker` are not read anywhere |
| Prefetch | The route is listed in `utils/routePrefetch.ts` (chunk preloading) |

### 8.4 File Security

| Item | Rule |
|---|---|
| Upload | `max:5120` KB; extension (from the client file name) in `pdf, jpg, jpeg, png, webp`; safe file name (`safeUploadName()`); random 24-char folder |
| Download | `downloadClarity()` refuses `..` and paths outside `p2p/clarity/`; allows your `c{client}` folder, or older files referenced by your client's products |
| Weakness | Extension-only check; files are on the public disk, so the direct `/storage/…` URL bypasses the download check |

### 8.5 Unique Email

`EnforcesUniqueEmail` on `P2pSupplier` and `Vendor` → `EmailGuard::conflict('vendor', …)`.
Scope `vendor` (`config/email_uniqueness.php`) is `tenant: false` — **system-wide**,
across `vendors.primary_email` and `p2p_suppliers.email` (non-deleted,
`lower(trim())`).

---

## 9. FRONTEND ARCHITECTURE

### 9.1 Helpers

| File | What it provides |
|---|---|
| `data.ts` | Types, `fromApi`, `progressOf`, `tatState` (`'ontrack' \| 'atrisk' \| 'overdue'`), `todayIso` |
| `format.ts` | `dmy()`, `initials()`, `inr()`, `limitNum()` + caps |
| `targetProducts.ts` | `useTargetReport(row, refreshKey)` (keeps old rows while reloading); `viewDocument()` (opens the tab first, so pop-up blockers allow it) |
| `useSaveGuard.ts` | Ref-based single flight: one save at a time, a `saving` flag, no state updates after unmount |
| `upload.ts` | Multipart with the boundary set by the browser |
| `apiError.ts` | `apiErrorMessage` (message → first field error → fallback); `apiFieldErrors` (first message per field) |
| `popupHooks.ts` | `usePopup`: Esc stack, counted scroll lock on `body` **and** `html`, focus trap, stands down while a shared layer is open. `useFitRows`: table height = header + N rows |

### 9.2 Money Display — `inr()`

* Target price as `₹` + Indian grouping + exactly 2 decimals.
* Commas stripped first; a value that isn't `^\d+(\.\d+)?$` returns `—`.
* Grouping is done on the **text**, not through `Number()`, so a long value (older targets hold 30+ digits) keeps every digit.
* Every target-price display is wrapped in `FitTip` (one line, "…" + tooltip only when cut): Report (`.str-price-cell`), Product List (`.stpl-price-cell`), Map Supplier header pill (`.stmap-ppill--price`, max 200 px), Mapped Suppliers tile.

### 9.3 Typing Caps — `limitNum()` (CS-2308, `6170fa175`)

| Constant | Value | Matches server |
|---|---|---|
| `PRICE_INT` / `PRICE_DEC` | 10 / 2 | `MAX_PRICE` 9,999,999,999.99 |
| `RATE_INT` / `RATE_DEC` | 5 / 4 | `MAX_RATE` 99,999.9999 |

Used by `AssignTargetModal` (manual adder price, every row's target price),
`SupplierMasterForm` (price, rate) and `NewSupplierForm` (unit price, rate).
`"12a.3.45"` → `"12.34"`.

### 9.4 Lazy Loading and Popup Ownership

| Item | Detail |
|---|---|
| `React.lazy` | `AssignTargetModal`, `SourcingTargetReport`, `ProductList`, `MapSupplierModal`, `AddVendorModal` (each in its own Suspense) |
| Static inside them | `MappedSuppliers`, `ClarityDialog`, `ClarityNoteView`, `SupplierMasterForm`, `NewSupplierForm`, `SupplierTypeChooser` |
| Convert | Loads `AddVendorModal` **in parallel** with the prefill request |
| Owned by the page | Assign / Edit, Product List, Report, Map Supplier, Convert |
| Owned by the Report | Mapped Suppliers |
| On Edit a mapping | Mapped Suppliers **stays open** behind Map Supplier and re-reads when `reportRefresh` changes; **Add Supplier** closes it first |
| Refresh counters | `reportRefresh` / `reloadKey`, bumped after a map, edit, convert or save |

### 9.5 Auto-Fit Tables

| Table | Rule |
|---|---|
| List | `useFitPageSize` (at least 4 rows) |
| Report / Product List | `useFitRows` with `rows = min(VISIBLE_ROWS (5), rows of the viewed tab)` (CS-2215) |
| Form product list | Scrolls after `PLIST_ROWS` (4) |

### 9.6 Dropdown Widths

| Dropdown | Class | CSS rule | Result |
|---|---|---|---|
| Supplier Master picker | `stsm-sup-menu` (`supplier-master-form.css`) | `.master-select-menu.stsm-sup-menu:not(:has(.master-select-empty)) { width: 0 !important }` + `max-width: calc(100vw - 24px)` | With rows: the field's width, no resize on scroll. Loading / empty: the field's plain width (before `6170fa175` it opened small, then jumped) |
| New Supplier dropdowns (Segment, Country, State, Currency, GST Rate, GST Type) | `stnf-ms-menu` (`map-supplier-modal.css`) | `width: 0 !important; max-width: none !important` + `.stnf-ms-menu .master-select-item { overflow: hidden }` | The field's width; long names end in "…" |

Other picker details: each option has a `fullLabel` (tooltip on a cut name);
placeholder / `emptyText` *Loading suppliers…* until the pool arrives; already
mapped Master suppliers are `disabled` with `disabledReason` and
`onDisabledClick` (`onTakenClick()` → toast *Already mapped*). The New Supplier
summary tiles (`.stnf-k`) use `min-width: 0` + `overflow-wrap: anywhere`.

### 9.7 Other Behaviour

| Item | Detail |
|---|---|
| View only (`AssignTargetModal`) | `locked` disables TAT and source; adders not rendered; prices `readOnly`; clarity and remove buttons disabled; `ClarityNoteView` gets no `onEdit` |
| Mapped Suppliers segment tag | `s.segment \|\| segment` (the product's) |
| Currency defaults | The browser's country → currency list (incl. AUD, CAD, CHF, HKD, QAR) is wider than the server's (USD fallback); a Supplier Master pick uses the server value |

### 9.8 Reuse of the Supplier Wizard (`AddVendorModal`)

| From | Props | After save |
|---|---|---|
| **Convert to Supplier** | `scope`, `prefill`, `convertSupplierId`, `canMapProducts={false}` | Already linked at Contacts; `finishConvert()` → `POST …/convert {vendor_id}` (confirms, copies the card), toast, `converted` set, report reopens. Cancel (`closeConvert()`) reopens the report |
| **"+" in Supplier Master form** | `scope`, `canMapProducts={false}` | Reload `/p2p/suppliers?origin`, select the new supplier |

---

## 10. UI — RESPONSIVE LAYOUT, DARK MODE AND CSS

### 10.1 Dark Mode

Every CSS file has full `[data-bs-theme="dark"]` styling. In dark mode the
selected main tab (`.sct-tab.is-active`) is a deep teal gradient with white
text, icon tile and count.

### 10.2 Responsive Layout

| Area | Behaviour |
|---|---|
| List grid (`.sct-row`) | `min-width` 1516 px; 1264 px at ≤ 1600 px; 1116 px at ≤ 768 px. Scrolls sideways only when narrower, with a **sticky Action column** |
| ≤ 1100 px | Only `.sct-mainrow` wraps (search on its own line) |
| ≤ 768 px | Strip stacks, main tabs wrap, **sub-tabs scroll sideways** (`.sct-subrow { overflow-x: auto }`), report button icon-only |
| ≤ 480 px | Strip buttons stack full-width |

**Popup breakpoints**

| File | Breakpoints (px) |
|---|---|
| `sourcing-target-report.css` | 1100 / 700 |
| `assign-target-modal.css` | 900 / 700 |
| `popup-shell.css` | 700 |
| `supplier-master-form.css` | 760 / 480 |
| `mapped-suppliers.css` | 680 / 600 |
| `product-list.css` | 640 / 480 |
| `map-supplier-modal.css` | 640 |
| `attach-picker.css` | 640 |

### 10.3 CSS Prefixes

| Prefix | File | Area |
|---|---|---|
| `sct-` | `sourcing-tracker.css` | Page and list (`.page-content:has(> .container-fluid > .sct-page)`) |
| `sta-`, `stsrc-` | `assign-target-modal.css`, `popup-shell.css`, `attach-picker.css` | Target form |
| `str-` | `sourcing-target-report.css` | Report |
| `stpl-` | `product-list.css` | Product List |
| `stsv-` | `mapped-suppliers.css` | Mapped Suppliers (`.stsv-card-acts` — Edit, Convert, `.stsv-card-converted` — pinned right, `gap: 8px`) |
| `stmap-`, `stnf-` | `map-supplier-modal.css` | Map Supplier, New Supplier form |
| `stsm-` | `supplier-master-form.css` | Supplier Master form |
| `stfile-` | `attached-files.css` | Attached file list |

**Keep these prefixes.** `bulk-sourcing.css` is **global** and styles `.ast-`,
`.smp-`, `.asrc-`, `.snf-`, `.sv-` (it is also imported by Payment Request's
decline modal). The Mapped Suppliers rules were copied under `.stsv-*` for this
reason.

---

## 11. INTEGRATION WITH OTHER MODULES

| Module | Integration |
|---|---|
| **Bulk Sourcing** | Same tables and endpoints (incl. `…/clarity` PUT, `…/price` PATCH, `/p2p/team-members`, convert). Its `AssignSourcingTargetModal.tsx` also allows self-assign. Its menu entry is **commented out** in `constants.ts` (`p2p.bulk_sourcing`) — reachable only by URL |
| **Supplier Master** | `vendors` and their primary address; the Add Supplier wizard (Convert, "+"); `storeContacts()` performs the Convert link; email uniqueness shared between `vendors` and `p2p_suppliers`; business card copied by `convertSupplier()` |
| **Product Master** | Product picker, snapshot, live name / segment / HSN; PostgreSQL `regexp_replace(...)::int` ordering of codes |
| **Masters** | CLM segments, countries, states, state codes, GST %, currencies (non-INR, with rates) — through `MasterVisibility` |
| **Branch** | `state` / `gst_state_code` = home state for intra / inter GST |
| **HR** | Employees (any department, onboarding stage ≥ 6), department names, designations, `emp_code` |
| **Shared UI** | `FitTip` (Create PO), `CameraCaptureModal` (Physical Inspection), `AttachPicker` (also used by AddVendorModal and ServiceFormModal) |

---

## 12. DATA SOURCE AND STORAGE MAP

"Computed" = never stored. "—" = not stored by this screen.

### 12.1 The List (`SourcingTracker.tsx`, `GET /p2p/sourcing-targets`)

| Field on screen | Comes from | Stored in / by |
|---|---|---|
| Sr No | browser: `(page − 1) × pageSize + i + 1` | — |
| Sourcing Target ID | `T.code` | `store()` |
| Start date | `T.start_date` | `store()` (server's today) |
| I Want to Source To (chips) | distinct `P.source` → *Product Master* / *Manual Entry*; fallback `T.source` | `syncProducts()` / `store()` / `update()` |
| Sourcing TAT (date, colour, OVERDUE) | `T.due_date`; colour = `tatState()` | `store()` / `update()` |
| Created By | `T.created_by_name`; `createdById` = `T.created_by` | `store()` |
| Assigned To | `T.assignee_name`; `assigneeId` = `T.assignee_id` | `store()` only |
| Total Products (first name, +N) | lowest-id `P.name`; `+N` = count − 1 | `syncProducts()` |
| Mapped Suppliers | Σ `COUNT(M)` per product | `mapSupplier()` |
| Progress | computed from `P.status` | `P.status` by `mapSupplier()` |
| Edit enabled | `createdById === me` | — |
| Tab badges | `counts` | — |
| RFQ badge | constant `RFQ_COUNT = 129` | — |

### 12.2 Assign / Edit Sourcing Target (`AssignTargetModal.tsx`)

| Field on screen | Comes from | Stored in / by |
|---|---|---|
| Sourcing Target ID | Add: `GET …/next-code` (preview); Edit: `GET …/{code}` | `T.code` by `store()` (under a lock) |
| Start Date | Add: browser today (display); Edit: `T.start_date` | `T.start_date` = server today, `store()` only |
| Sourcing TAT | user; Edit: `T.due_date` | `T.due_date` |
| Assign To — options | `GET /p2p/team-members` (`users`, `employees`, `master_departments`, `master_designations`) | — |
| Assign To — chosen | user | `T.assignee_id`, `T.assignee_name`, `store()` only |
| Assign To (Edit, locked) | `T.assignee_name` | never changed |
| View Only | `show().assigneeActive` | — |
| I want to source from | user; Edit: `T.source` | `T.source` |
| Select Products — options | `GET /p2p/products` (client + branch `products`, `clm_segments.name`, `master_hsn_codes.hsn_code`; code padded) | — |
| Master row: Product Code | the picker's code | `P.code` (as sent) |
| Master row: Name / Segment / HSN | Add: picker; Edit: **live** via `productDisplayResolver()` | `P.name`, `P.segment`, `P.hsn` **snapshot**; `P.product_id` |
| Manual row: Product Name | user | `P.name` |
| Target Price (₹) | user (capped by `limitNum`); Edit: `P.target_price` without commas | `P.target_price` (string) |
| Clarity chip | form state; Edit: `P.clarity_type` / `P.clarity_value` | same columns |
| Lock icon | `show()` `mapped` = `COUNT(M) > 0` | — |
| Removed product | — | `P.deleted_at` (and `M.deleted_at`) |

### 12.3 Product Clarity (`ClarityDialog.tsx`)

| Field | Comes from | Stored in / by |
|---|---|---|
| Text | user / `P.clarity_value` | `P.clarity_type = text`, `P.clarity_value` = note |
| Link | user / `P.clarity_value` | `P.clarity_type = link`, `P.clarity_value` = URL |
| PDF / image | user's file | file `p2p/clarity/c{client}/{random24}/{name}.{ext}` (`upload()`); `P.clarity_type = pdf`, `P.clarity_value` = `/storage/…` path |
| Product line (header) | the form's row | — |

### 12.4 Product List and Report (`GET …/{code}/report`)

| Field on screen | Comes from | Stored in / by |
|---|---|---|
| Header code, source, start, due, created by, assigned to | the **list row** (`T`) | — |
| Status pill, Total / Completed / Pending / % | computed from `P.status` | — |
| Due Date in red | `tatState(row)` | — |
| Generated <date> | browser today | — |
| Product Code | `P.code` padded | — |
| Product Name, Segment, HSN | **live** master values for master rows with a `product_id`; else the `P` snapshot | — |
| Target Price | `P.target_price` → `inr()` | — |
| Product Clarity (Report) | `P.clarity_type`, `P.clarity_value` | — |
| Sourcing Status | `P.status` (*Completed* / *Pending*; Product List: *Completed* / *In Progress*) | `mapSupplier()` |
| Supplier Count | `COUNT(M)` | — |

### 12.5 Map Supplier Header and Type Chooser

| Field | Comes from | Stored |
|---|---|---|
| Product Name, Code, Segment, Target Price, Suppliers Mapped | the report's product row | — |
| *"{n} available"* | `GET /p2p/suppliers` (all origins), counted in the browser | — |

### 12.6 Supplier Master Form (`SupplierMasterForm.tsx`)

| Field on screen | Comes from | Stored in M (by `mapSupplier()`) |
|---|---|---|
| Supplier Name — options | `GET /p2p/suppliers?origin=` → `vendors` (`forUser`), `company_name`, `vendor_code`, vendor type | `M.supplier_id` = `vendors.id`, `M.source = master`, `M.name` = `company_name` |
| Greyed options | `GET …/products/{id}/suppliers` (Master rows) | — |
| Supplier Code | `vendors.vendor_code` | not stored |
| Supplier Type | vendor type master name | — |
| State / GST State Code (Domestic) | primary `vendor_addresses` → `master_states.name`, `state_code` | `M.state`, `M.state_code` (re-read on the server) |
| Country / City / Region (International) | primary address → `master_countries.name`, `city`, state | `M.country`, `M.city`, `M.state` |
| Contact Person | address `contact_name` | `M.contact` |
| (not shown) mobile, email, segment | address `contact_no`; address `email` else `vendors.primary_email`; vendor segment name | `M.mobile`, `M.email`, `M.segment` |
| Price | user (capped 10 + 2) | `M.price` (2 dp) |
| GST % | `master_gst_percentage`; default 18 | `M.gst_percentage` |
| GST Amount / Total (₹) | browser preview | `M.gst_amount`, `M.cgst_amount`, `M.sgst_amount`, `M.igst_amount`, `M.total_amount`, `M.inr_amount` (server) |
| (not on form) GST type | server: vendor state vs the user's branch | `M.gst_type` |
| Currency | server's `currency` for the vendor; options `master_currencies` (non-INR) | `M.currency_code` |
| Exchange Rate | user (capped 5 + 4); default master rate | `M.exchange_rate` (4 dp) |
| Total Amount ({cur}) | = price | `M.total_amount` = price; `M.inr_amount` = price × rate |
| — | — | `M.origin`, `M.price_valid_till` (null on add; resent on Edit), `M.mapped_by`, `P.status = Completed` |

### 12.7 New Supplier Form (`NewSupplierForm.tsx`)

M is always written; D only when a new directory entry is created (PUT also updates D).

| Field on screen | Comes from | Stored in |
|---|---|---|
| Supplier Company Name | user; Edit: `M.name` | `M.name`, `D.name` (looked up by `LOWER(name)`) |
| Contact Person | user / `M.contact` | `M.contact`, `D.contact` |
| Mobile Number | user / `M.mobile` (Domestic: last 10 digits) | `M.mobile`, `D.mobile` |
| Segment | `clm_segments` (form-masters) | `M.segment`, `D.segment` (name) |
| Email ID | user / `M.email` | `M.email`, `D.email` (unique system-wide on D create) |
| Google Location Link | user / `M.gmaps` | `M.gmaps`, `D.gmaps` |
| Street Address | user / `M.address` | `M.address`, `D.address` |
| Country | Domestic: *India* sent; International: `master_countries` minus India | `M.country`, `D.country` |
| State | Domestic: `master_states` of India; International: free text | `M.state`, `D.state` |
| State Code | auto from `master_state_codes` (statutory first); editable | `M.state_code`, `D.state_code` (Domestic only) |
| City | user | `M.city`, `D.city` |
| Unit Price | user (capped 10 + 2) | `M.price` |
| GST Rate | `master_gst_percentage`; default 18 | `M.gst_percentage` |
| GST Type | default from `homeState` (`branches.state`, by name); user | `M.gst_type` (as sent) |
| Currency | `master_currencies` (non-INR); suggestion `COUNTRY_CURRENCY` | `M.currency_code` |
| Exchange Rate | default master rate; user (capped 5 + 4) | `M.exchange_rate` |
| Price Valid Till | user | `M.price_valid_till` |
| Summary tiles | browser | server's own figures in `M.*_amount`, `M.total_amount`, `M.inr_amount` |
| HSN / Target Price chips | report's product row | — |
| Business Card | `upload(kind=card)` | file `p2p/supplier-cards/c{client}/{random24}/…`; `M.card_path`, `D.card_path` |
| — | — | `M.supplier_id` = `D.id`, `M.source = new`, `M.origin`, `M.mapped_by`; `D.client_id`, `D.branch_id`, `D.origin`, `D.created_by`; `P.status = Completed` |

### 12.8 Mapped Suppliers Popup (`GET …/products/{id}/suppliers`)

| Field on screen | Comes from |
|---|---|
| Header tiles | the list row and the report's product row |
| Suppliers Mapped | number of cards |
| Card name, contact, mobile, email, segment | the `M` **snapshot** (segment falls back to the product's) |
| Tag Domestic / International | `M.origin` |
| Tag Master / New Supplier | `M.source` |
| Price figures, Valid Till | `M.price`, `M.gst_percentage`, `M.gst_type`, `M.*_amount`, `M.total_amount`, `M.exchange_rate`, `M.inr_amount`, `M.price_valid_till`, `M.currency_code` |
| vs target | server (`SupplierPricing::vsTarget()` with `P.target_price`) |
| Convert button | `canConvert` |
| Converted badge | `converted`, plus the page's session set |

### 12.9 Convert to Supplier (prefill → wizard)

| Wizard field | Comes from (`convertPrefill()`) | Stored by the wizard in |
|---|---|---|
| Company Name, Legal Name | `D.name` | `vendors.company_name`, `vendors.legal_name` |
| Segment | `clm_segments.id` by `LOWER(D.segment)` | the vendor's segment(s) |
| GST Applicable | *No* when international, else empty | `vendors.gst_applicable` |
| Registered Office | `D.address` | vendor address; primary `vendor_addresses.address_line` |
| Country, State | ids by `LOWER(name)` | `vendor_addresses.country_id`, `state_id` |
| State Code, City, Google Location | `D.state_code`, `D.city`, `D.gmaps` | `vendor_addresses.state_code`, `city`, `google_location` |
| Contact Person, Contact No, Email | `D.contact`, `D.mobile`, `D.email` | primary `vendor_addresses.contact_name`, `contact_no`, `email`; `vendors.primary_email` (lower-cased) |
| Business card | `D.card_path` (returned, **not** put in the wizard) | `vendor_documents/{vendor}/…`, `vendor_addresses.attachment_path` by `copyBusinessCard()` |
| (link) | `convert_supplier_id` = `D.id` | `M.source/supplier_id/name` moved or `M.deleted_at`; `D.converted_vendor_id`, `converted_at`, `converted_by` |

---

## 13. KNOWN TECHNICAL ISSUES

Grouped by area. The number in brackets is the issue's ID from earlier versions
of this document, kept so old references still work.

### 13.1 Data Integrity

| # | Issue | Where |
|---|---|---|
| 1 | Target code is **count + 1** with **no unique index**; duplicates possible, resolved with `first()` | `BE::store()`, `nextCode()`, `target()` |
| 6 | New Supplier directory reuse by **name** doesn't refresh the entry; two different suppliers with one name share one entry (and one Convert) | `BE::mapSupplier()` |
| 7 | No transaction around directory create + mapping create (orphan only if the mapping insert fails) | `BE::mapSupplier()` |
| 18 | `p2p_sourcing_targets.status` is never updated; legacy `sourcing_targets` tables unused | — |
| 22 | `p2p_sourcing_products.segment` is `string(128)`; a 129–255 char segment name → **500** on save. *(The other two segment columns were fixed to 512.)* | `BE::syncProducts()`; migration `2026_06_23_000020` |
| 23 | An unknown master product code is saved with `product_id` null | `BE::syncProducts()` |
| 24 | Convert keeps the New Supplier's contact snapshot on moved mappings | `convertSupplier()`, `storeContacts()` |
| 43 | `updateSupplier()` mass-updates the **shared** `p2p_suppliers` row (name included) — affects every mapping of it on every target; no uniqueness check on the new name | `BE::updateSupplier()` |

### 13.2 Performance

| # | Issue | Where |
|---|---|---|
| 2 | The list loads **every** target and product of the client and filters / pages in PHP; `syncProducts` may load all client products into memory | `BE::trackerList()`, `syncProducts()` |

### 13.3 Validation and Business Rules

| # | Issue | Where |
|---|---|---|
| 3 | Searching for `"0"` is ignored (falsy check) | `BE::trackerList()` |
| 4 | **Re-quoting a Master mapping after its Valid Till has passed always fails** — the old date is resent and the form has no field for it | `SupplierMasterForm.tsx save()`, `updateSupplierPrice()` |
| 12 | `store()` doesn't re-check the assignee list rules (branch, onboarding) | `assigneeAllowed()`, `teamMembers()` |
| 14 | Business card: server allows WEBP, the FE doesn't | `NewSupplierForm.tsx` `CARD_ACCEPT` / `CARD_EXT` |
| 16 | Overdue uses the **server** time zone, at risk the **browser's** date | `BE::row()`, `tatState()` |
| 21 | `PUT …/clarity` without `clarity_type` → **500** | `BE::updateProductClarity()` |
| 25 | A domestic New Supplier at 0 % GST reopens at 18 % | `MappedSuppliers.tsx editOf()` |
| 34 | `suppliers()` has **no vendor status filter**; chooser counts include already-mapped vendors | `BE::suppliers()`, `MapSupplierModal.tsx` |
| 35 | Re-price derives Domestic `gst_type` from the **current user's** branch — can flip intra ↔ inter | `updateSupplierPrice()` → `sourcingPrice()` |
| 36 | New Supplier `gst_type` is trusted as sent | `BE::sourcingPrice()` |
| 37 | `teamMembers()` filters the **user's** branch, not the employee's | `BE::teamMembers()` |
| 39 | No server numeric cap on `target_price` (`max:64` chars only) | `validatePayload()`, `format.ts` |
| 40 | `PUT …/suppliers/{m}` does not update `mapped_by`; `PATCH …/price` does | `updateSupplier()`, `updateSupplierPrice()` |
| 41 | Edit supplier & quote resends the saved `valid_till`; once past, PUT refuses it (Laravel's default message) until changed or cleared | `editOf()`, `NewSupplierForm.tsx save()`, `updateSupplier()` |
| 42 | Edit price silently resets a GST % that is no longer an active master rate | `SupplierMasterForm.tsx` GST-rate effect |

### 13.4 Security and Access

| # | Issue | Where |
|---|---|---|
| 5 | `updateSupplier` writes the directory with `update()` — **skips the unique-email check** | `BE::updateSupplier()` |
| 8 | A comment says contact details are masked; they are returned **unmasked** | `MappedSuppliers.tsx`, `mappedRow()` |
| 9 | `setProductStatus` / `updateProductClarity` use the **view** check, so client / super admin can write | both methods |
| 11 | Mapping and price edits are **not** blocked when the assignee is inactive; client admin can view but not map | `canMapSuppliers()` |
| 13 | Upload checks the **extension only**; direct `/storage/…` URL bypasses the download check | `upload()`, `downloadClarity()` |
| 20 | Convert checks only the company — any user of the company can convert any New Supplier | `convertPrefill()`, `convertSupplier()`, `storeContacts()` |
| 38 | `hierarchicalDenial()` returns null for every `Vendor` — the 403 branch in `storeContacts()` is dead code | `storeContacts()`, `MasterVisibility` |

### 13.5 User Experience

| # | Issue | Where |
|---|---|---|
| 10 | No unmap endpoint; Completed never reverts | — |
| 17 | `RFQ_COUNT = 129` is hard-coded | `SourcingTracker.tsx` |
| 19 | Clarity / card files from a failed save are never deleted | — |
| 27 | Wizard abandoned **after** Contacts → converted but card never copied; abandoned **before** → the created vendor stays unlinked | `storeContacts()`, `convertSupplier()` |
| 29 | `converted` is per **vendor** — a Master row mapped straight from the Supplier Master can show the badge | `mappedSuppliers()` |
| 31 | The picker greys out only Master rows; the CS-2308 case is caught only by the server's 422 | `SupplierMasterForm.tsx`, `mapSupplier()` |
| 32 | **Edit price fails silently** when the vendor isn't in the branch-scoped pool (converted in another branch, or country changed) | `SupplierMasterForm.tsx save()`, `suppliers()` |
| 33 | No delete for a sourcing target | `routes/api.php` |

### 13.6 Code Quality

| # | Issue | Where |
|---|---|---|
| 15 | `sourcing_count` counts targets in one endpoint and mapping rows in another | `newSuppliers()`, `convertPrefill()` |
| 28 | The move / merge logic is **duplicated** in `storeContacts()` and `convertSupplier()` | both |
| 30 | `updateSupplierPrice()` always returns `converted: false` (harmless; the screen re-reads) | `updateSupplierPrice()` |
| 44 | Stale comments: `AssignTargetModal.tsx` (*"so they cannot be its assignee"*) and the headers of `MapSupplierModal.tsx`, `MappedSuppliers.tsx`, `SourcingTargetReport.tsx` (*"assignee only"*) | named files |

### 13.7 Fixed

| # | Fix | Where |
|---|---|---|
| 22 (part) | `p2p_suppliers.segment` and `p2p_sourcing_product_suppliers.segment` widened to 512 | `2026_06_24_000010_widen_p2p_segment_columns` |
| 26 | The Convert link moved to the Contacts step (an abandoned wizard no longer leaves it unlinked); `convertSupplier()` looks up the vendor client-wide | `bf7dad2ed` |

---

## END OF DOCUMENT

| Item | Covered |
|---|---|
| Stack and architecture | Sections 2–3 |
| Files and routes | Sections 4–5 |
| Database tables and relationships | Section 6 |
| Business rules (code, list, create / edit, assignee, clarity, mapping, pricing, Convert) | Section 7 |
| Security | Section 8 |
| Frontend internals | Section 9 |
| Responsive, dark mode, CSS | Section 10 |
| Integrations | Section 11 |
| Field-level data map | Section 12 |
| Known issues (44, grouped) | Section 13 |

**Related documents:** Functional Documentation · Code Walkthrough · API
Documentation.

**Verified against code up to:** commit `6170fa175`.
