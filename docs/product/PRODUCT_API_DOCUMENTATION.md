# PRODUCT MODULE — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · P2P → Master Management → Product Management
> Base URL: `{APP_URL}/api` · Requires `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-10-06 | System | Initial API documentation |
| 1.1 | 2026-10-07 | System | Added dropdown conditions, pagination, product card |

---

## 1. CONVENTIONS

- Auth: `auth:sanctum` + `user.active` + `tenant`. **No module-permission check in the controller** — the `p2p.product` slug only drives the menu; the SPA additionally restricts the page to `branch_user` / `employee`.
- **Edit/delete guard:** `editDenial()` — an employee of the product's own branch may edit any branch product; everyone else falls to `MasterVisibility::hierarchicalDenial` (creator or equal/higher tier). Denial → **403** `{ message }`.
- **Read scope:** employees see globals + client-level + own-branch rows (`applyBranchScope`); other user types use `applyReadScope`. The BranchSwitcher `?branch_id=` narrows **only** `GET /products` and `/products/stats`; `show`/steps ignore it.
- **Department wall (read-side):** Purchase-dept employees get selling fields nulled (`base_price, gst_id, gst_amount, total_price, mark_bottom`, `gst_percentage` dropped); Sales-dept employees get `vendor_maps: []` + `vendor_count`.
- `{id}` / `{mapId}` are numeric (`whereNumber`). Status codes: 200 · 401 · 403 · 404 · 422.

---

## 2. ENDPOINT INDEX

### Product
| Method | Path | Purpose |
|---|---|---|
| GET | `/products` | Paginated list + tab counts (filters, sort, `lite`) |
| GET | `/products/stats` | Tab counts only (mapped / zero-supplier) |
| GET | `/products/owners` | Same-branch users for the owner filter |
| GET | `/products/master-bundle` | All form dropdowns + vendors (cached 5 min) |
| GET | `/products/{id}` | Detail + QC `segment_uploads` |
| GET | `/products/{id}/usage` | Leads / PO / PI / SPI references (segment + GST lock) |
| POST | `/products/step/core` | Create or update Core (multipart) |
| PUT | `/products/{id}/step/sales` | Selling price + GST (cascades to vendor maps) |
| PUT | `/products/{id}/step/quality` | Dimensions, inventory ids, QC records (legacy) |
| PUT | `/products/{id}/step/vendors` | Full replace of supplier mappings |
| DELETE | `/products/{id}` | Soft delete |

### Vendor maps
| Method | Path | Purpose |
|---|---|---|
| GET | `/products/{id}/vendor-maps` | Supplier rows (Sales Matrix Stage 3 popup) |
| PATCH | `/products/{id}/vendor-maps/{mapId}` | Inline purchase-price edit |
| DELETE | `/products/{id}/vendor-maps/{mapId}` | Unmap one supplier |

---

## 3. KEY ENDPOINT DETAIL

### 3.1 GET `/products`
**Query:** `q` (ILIKE name/product_code/brand/generic_name/HSN; numeric tail also matches `%-0N`), `status` (`active` · `draft` · `inactive` = inactive+draft), `supplier` (`mapped` · `zero`), `vendor_id`, `segment[]`, `segment_eq`, `hsn[]`, `uom[]`, `condition[]`, `haz_class[]`, `gst_rate[]`, `vendor[]`, `haz_type[]` (`HAZ`/`NON HAZ`), `owner[]` (users.id), `created_from`, `created_to`, `created_bucket[]` (`last_7`/`last_30`/`last_90`/`older`/`last:<n>`), `sort` (`price-asc`/`price-desc`; anything else = newest first), `per_page` (default 24, clamp 1–200; SPA sends 12), `page`, `lite=1` (loads only hsn/segment/gstPercentage).
**Response 200:** Laravel paginator + `counts`:
```json
{ "current_page": 1, "data": [ { "id": 41, "product_code": "P-007", "name": "…", "status": "active",
  "segment": {…}, "hsn": {…}, "gst_percentage": {…}, "vendor_maps": [ {"id":9,"product_id":41,"vendor_name":"…"} ],
  "qc_records": [], "primary_image_url": "…", "secondary_images_url": [], "product_attachment_url": null } ],
  "per_page": 12, "total": 57, "counts": { "active": 40, "inactive": 17 } }
```
`counts` are computed **before** the `supplier` tab is applied.

### 3.2 POST `/products/step/core` (multipart)
Create when `id` absent; update when `id` given.
**Body:** `id` (exists:products), `name`* (≤100), `generic_name` (≤255), `description` (≤10000; CRLF normalised), `brand` (text), `segment_id`, `haz_type` (≤20), `haz_class_id`, `uom_id`, `hsn_id`, `condition_id`, `packaging_material_id` (all nullable integers), `confidential_info` (≤2000), `gst_id`, `primary_image` (kept path) / `primary_image_file` (jpg/jpeg/png ≤2 MB), `secondary_images[]` (kept paths) / `secondary_image_files[]` (≤10 files, jpg/jpeg/png ≤2 MB each), `secondary_images_replace` (bool), `product_attachment` / `product_attachment_file` (pdf/doc/docx/jpg/jpeg/png/gif/webp ≤10 MB).
**On create:** `client_id/branch_id/created_by` from the token, `product_code` = next `P-NNN` for the branch, `status=draft`. `step_completed` ≥ 1.
**Response 200:** the masked product (includes `id`, `product_code`, image URLs).
**Errors:** 403 (editDenial) · 404 (out of scope) · 422 (validation / GST lock on `gst_id`).

### 3.3 PUT `/products/{id}/step/sales`
**Body:** `base_price`, `gst_amount`, `total_price` (numeric ≥0), `gst_id` (int), `mark_bottom` (≤30).
Sets `step_completed` ≥ 2; `draft → inactive`. Re-derives every vendor map's `gst_percentage/gst_amount/total_amount` from the product GST and mirrors onto `vendor_product_mappings`.
**Errors:** 403 · 404 · 422 (`gst_id` change while the product is on a PO/PI/SPI).

### 3.4 PUT `/products/{id}/step/quality`
**Body:** `net_weight`, `gross_weight`, `length_cm`, `width_cm`, `height_cm` (≥0), `batch_no`/`serial_no`/`cat_no`/`lot_no` (≤100), `qc_records[]` { `qc_name`* (≤100), `qc_purpose`, `issued_by`, `qa_testing_parameter`, `min_acceptance_criteria`, `attachment_path` (kept only if under `products/qc/`), `attachment_file` (jpg/jpeg/png/pdf ≤10 MB) }. QC list is a **full replace**. `step_completed` ≥ 3; `draft → inactive`. *(The current SPA no longer calls this step.)*

### 3.5 PUT `/products/{id}/step/vendors`
**Body:** `vendors` (**present**, may be `[]`) — each: `vendor_id` (exists:vendors), `vendor_code` (≤50), `vendor_name`* (≤255), `vendor_website`, `contact_person`, `contact_no` (≤50), `email`, `designation` (≤100), `attachment_path`, `purchase_price` (≥0), `gst_percentage`/`gst_amount`/`total_amount` (ignored — recomputed), `map_date`, `remarks`.
**Rules:** segment gate (supplier's `segment_id` + `vendor_segments` must include the product's segment, else 422 "Segment mismatch: …"); GST forced to the product's rate; mirrored onto `vendor_product_mappings`; each mapped vendor promoted to `step_completed ≥ 4`, `status=active`. Non-empty list → product `active`, `step_completed=4`; empty → `inactive`.

### 3.6 GET `/products/{id}/usage`
**Response 200:**
```json
{ "status": true, "data": { "leads": [ {"lead_id":12,"opp_code":"OPP-…","has_customer":true,"customer_name":"…"} ],
  "lead_count": 1, "blocking_leads": [ … ], "po_codes": [], "pi_codes": ["PI/26-27/0004"], "spi_codes": [],
  "latest_po_code": null, "latest_pi_code": "PI/26-27/0004", "latest_spi_code": null,
  "in_po_or_spi": false, "segment_locked": true, "gst_lock_codes": ["PI/26-27/0004"], "gst_locked": true } }
```

### 3.7 Vendor-map endpoints
- **GET `/products/{id}/vendor-maps`** → `{ status, data: [ProductVendorMap…], count }` (Sales dept → `data: []`).
- **PATCH `…/vendor-maps/{mapId}`** body `purchase_price`* (≥0) → recomputes amount/total from the row's stored GST %; mirrors vendor side. Returns the product.
- **DELETE `…/vendor-maps/{mapId}`** → deletes the map + vendor-side mirror row. Returns the product. (Does **not** downgrade product status.)

### 3.8 Helpers
- **GET `/products/stats`** → `{ active, inactive, total }` (same filters as the list, minus the tab).
- **GET `/products/owners`** → `{ data: [ {id, name, branch_id, branch_name} ] }`; empty for non-branch/employee users.
- **GET `/products/master-bundle`** → `{ segments, haz_class, uom, hsn_codes, conditions, packaging_material, gst_percentage, vendors }` (active rows only; per-user cache 5 min).
- **DELETE `/products/{id}`** → `{ "deleted": true }` (soft delete, no usage check).

### 3.9 Pagination contract (`GET /products`)
| Item | Value |
|---|---|
| Mode | Server-side, Laravel `LengthAwarePaginator` (`$query->paginate($perPage)`) |
| Params | `page` (1-based), `per_page` = `max(1, min(per_page ?? 24, 200))` |
| Response keys | `current_page, data, first_page_url, from, last_page, last_page_url, links, next_page_url, path, per_page, prev_page_url, to, total` **+ `counts {active, inactive}`** |
| Order of operations | scope → `applyListFilters` → `counts` → `supplier` tab → sort → paginate |
| SPA usage | `Products.tsx` sends `page`, `per_page` (12 default; 8/12/16/24/48) and reads only `data`, `total`, `counts` |

Endpoints that do **not** paginate: `/products/stats` (counts), `/products/master-bundle` (every active row, `orderBy id`; vendors `orderByDesc id`), `/products/{id}/vendor-maps` (all rows, `orderBy id`), `/products/owners` (all, `orderBy name`), `/products/{id}/usage`, `/p2p/products` (all, code-series order), `/sales/leads/{id}/products` (all, `orderByDesc id`).

### 3.10 Product-list calls made by pickers
| Screen (file) | Request | Effective result |
|---|---|---|
| Products list (`Products.tsx`) | `GET /products?supplier=…&sort=recent&page=n&per_page=12&…filters` | One page |
| Sales Matrix Product Directory (`ProductDirectoryModal.tsx`) | `GET /products` | 24 newest, any status |
| Quotation / PI (`SalesQPI.tsx`) | `GET /sales/qpi/master-bundle` → in-process `ProductController::index` with `per_page=200&status=active` (+ `branch_id` forwarded) | 200 newest active |
| Lead products (Stage 3/4/6, QPI narrowing) | `GET /sales/leads/{id}/products` | All rows of the lead |
| PO legacy wizard (`CreatePoWizard.tsx`) | `GET /products` | 24 newest, any status |
| PO new form (`po-api.ts` → `use-po-lookups.ts`) | `GET /products?lite=1&per_page=200` | 200 newest, any status |
| SPI (`SpiDetail.tsx`) | `GET /products?status=active` | 24 newest active |
| Supplier Map Product (`AddVendorModal.tsx`) | `GET /products?per_page=500&lite=1` | Capped to 200 newest |
| Bulk Sourcing (`AssignSourcingTargetModal.tsx`) | `GET /p2p/products` | All client products in branch |
| Stage 3 Vendor Count (`VendorMappingsModal.tsx`) | `GET /products/{id}/vendor-maps` | All maps |

The axios interceptor appends `branch_id` to every GET. Only `index`/`stats` (and `/p2p/products`, for users with no branch) honour it, and only for client-tier users. Branch users and employees are always locked to their own branch.

**`GET /p2p/products`** response: `{ data: [ { code: "P-007", name, segment, hsn } ] }` with `client_id = user.client_id` (no globals), `branch_id = user.branch_id ?: ?branch_id`, no status filter, ordered by `NULLIF(regexp_replace(product_code,'[^0-9]','','g'),'')::int ASC NULLS LAST, product_code`.

**`GET /sales/leads/{id}/products`** response rows: `id, product_id, product_code, product_name, product_status, product_category (segment name), currency, quantity, target_price, notes, sourcing_status, procurement_done, procurement_id, vendor_count, used_in_documents, …`. A soft-deleted product resolves to `null` code/name (the `product` relation excludes trashed rows).

---

## 4. ERROR EXAMPLES
**403 — employee editing a product they cannot manage**
```json
{ "message": "You cannot edit this record — employees can only manage rows they created themselves." }
```
**422 — GST change on a product already on a PO**
```json
{ "message": "GST % cannot be changed — this product is already used in PO/…. The tax on that document was calculated from the current rate.",
  "errors": { "gst_id": ["GST % cannot be changed — …"] } }
```

---

## 5. QUICK REFERENCE

```
GET  /products?supplier=mapped&per_page=12&page=1   # list + counts
GET  /products/master-bundle                          # form dropdowns
POST /products/step/core                              # create (P-NNN, draft) / update
PUT  /products/{id}/step/sales                        # price + GST → inactive
PUT  /products/{id}/step/vendors                      # suppliers → active
GET  /products/{id}/usage                             # segment / GST lock check
DELETE /products/{id}                                 # soft delete
```

---

## 6. NOTES (caveats)
1. No server-side module permission — any authenticated tenant user in scope can call these endpoints.
2. `product_code` allocation has no row lock; concurrent creates in one branch can collide on the unique index.
3. `DELETE /products/{id}` does not consult `/usage`; products on leads/PO/PI/SPI can be soft-deleted.
4. `vendors.*.vendor_id` uses a bare `exists:vendors,id` (not tenant-scoped).
5. `sort=rating` and the `owner` card data have no backing (no rating column; `creator` not eager-loaded).
6. Pickers that omit `per_page` get the default 24 rows; `per_page=500` is silently capped to 200 (§3.10).
7. `q` does not search segment (despite the list's placeholder text).
8. The department mask also applies to picker calls: Purchase-dept users receive `base_price`/`gst_id`/`total_price` = null and no `gst_percentage`.

---

*Related documents: PRODUCT_TECHNICAL_DOCUMENTATION.md · PRODUCT_FUNCTIONAL_DOCUMENTATION.md · PRODUCT_CODE_WALKTHROUGH.md*
