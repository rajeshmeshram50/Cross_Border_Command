# SUPPLIER MODULE — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · P2P → Master Management → Supplier Management
> Base URL: `{APP_URL}/api` · Requires `Authorization: Bearer <sanctum_token>`
> UI name **Supplier**; code name **Vendor** (`VendorController`, `vendors` table, `/vendors` routes).

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-10-06 | System | Initial API documentation |
| 1.1 | 2026-10-07 | System | Added dropdown conditions, pagination, supplier card |

---

## 1. CONVENTIONS

- Auth: route group `auth:sanctum` + `user.active` + `tenant` (`routes/api.php` 127). **No module-permission check server-side** — `VendorController` never calls an `authorize()`, and `MasterVisibility::hierarchicalDenial()` returns `null` for every `Vendor` row. The menu leaf is `p2p.supplier`, but it is enforced in the SPA only.
- Read scope: `Vendor::scopeForUser()` — employees get the **branch-shared** book (globals + client-level + own branch); client admins get their client (+ BranchSwitcher `branch_id`); branch users their own branch; super-admin all.
- `branch_id` is auto-injected on GETs by the Axios client; only `GET /vendors` honours it (`index` passes it as the switcher filter). `show`/`productMappings` ignore it.
- `{id}` is the numeric `vendors.id` (`whereNumber`). Out-of-scope id → **404** (`findOrFail` on the scoped query).
- Updates that carry files are sent as `POST` + `_method=PUT` (multipart).
- Uploads: `jpg,jpeg,png,webp,pdf`, ≤ **2048 KB** (`MAX_UPLOAD_KB`), stored on the `public` disk under `vendor_documents/{vendorId}/`.
- Validation messages use `FIELD_LABELS` ("vendor_type_id" → "supplier type").
- Status codes: 200/201 · 401 · 403 · 404 · 409 (segment-doc confirmation) · 422.

---

## 2. ENDPOINT INDEX

### Supplier (routes/api.php 184–206)
| Method | Path | Purpose |
|---|---|---|
| GET | `/vendors` | Paginated list + facets (or `?light=1` picker shape) |
| GET | `/vendors/master-bundle` | All dropdown masters for the wizard (cached 5 min / user) |
| GET | `/vendors/{id}` | Full supplier for the edit wizard + segment locks |
| GET | `/vendors/{id}/product-mappings` | Read-only "Mapped Products" popup rows |
| POST | `/vendors/step/identity` | Create (no `id`) or update Step 1 identity + registered address |
| PUT | `/vendors/{id}/step/contacts` | Replace the primary address / contact row |
| POST | `/vendors/{id}/step/kyc` | Replace-all DD / Owner KYC / Trade Licence (multipart) |
| POST | `/vendors/{id}/step/products` | Replace-all product mappings; activates supplier |
| DELETE | `/vendors/{id}` | Soft delete + purge files |

### Sub-resources (independent CRUD)
| Method | Path | Purpose |
|---|---|---|
| POST · PUT · DELETE | `/vendors/{id}/contacts[/{contact}]` | Additional contact persons (non-primary) |
| POST · PUT · DELETE | `/vendors/{id}/bank-accounts[/{bank}]` | Bank accounts (+ cancelled cheque) |
| POST · PUT · DELETE | `/vendors/{id}/gst-scrutiny[/{gst}]` | GST scrutiny records |

---

## 3. KEY ENDPOINT DETAIL

### 3.1 GET `/vendors`
**Query:** `q` (ILIKE over company/legal name, code, email, GST, category slug, contact name/no/email, city, state code, state, country, supplier type, segment), `status`, `scope` (`domestic` | `international` — no country counts as domestic), `tab` (`recurring` → always empty), `categories` (csv of `star,general,high_risk,blacklisted`), `compliance` (csv of `compliant,non_compliant`), `page`, `per_page` (default 24), `branch_id`.
**Response 200:** Laravel paginator + `facets`:
```json
{ "data": [ { "id": 12, "vendor_code": "S-004", "company_name": "…", "compliance_status": "Compliant",
              "product_mappings_count": 3, "opportunity_count": 0, "primary_address": {…}, "segments": [ … ] } ],
  "total": 41, "per_page": 24,
  "facets": { "grand_total": 41, "category": { "star": 2, "general": 37, "high_risk": 1, "blacklisted": 1 },
              "compliance": { "compliant": 30, "non_compliant": 11 } } }
```
**`?light=1`** → unpaginated `{ count, data: [ { id, db_id, vendor_code, company_name, country, mobile, primary_email } ] }`, ordered by name.

### 3.2 GET `/vendors/{id}`
`{ data: <shape>, segment_uploads: { data, by_category, count } }`. `data` adds: `primary_address`, `extra_contacts[]`, `due_diligence[]`, `owner_kyc[]`, `trade_licenses[]`, `bank_accounts[]`, `gst_scrutiny[]`, `product_mappings[]`, `segment_ids`, `locked_segments`, `locked_segment_reasons` (`{segId: "po"|"spi"|"product"}`), `state_locked` (true once a PurchaseOrder references the supplier), `segment_required_doc_keys`, `uploaded_doc_keys`.

### 3.3 POST `/vendors/step/identity`
**Body:** `id` (omit to create), `company_name`*, `legal_name`* (≤255), `website` (≤500), `gst_applicable` (`Yes|No`), `gst_number` (≤30), `vendor_type` (name → find-or-create `master_vendor_types`) or `vendor_type_id`, `risk_level_id`, `vendor_behaviour` (name → find-or-create) or `vendor_behaviour_id`, `segment_ids[]` (or csv; filtered to the caller's `clm_segments`), `segment_id`, `classification_id`, `compliance_behaviour_id`, `supplier_category` (`star|general|high_risk|blacklisted`), `address{address_line, country_id, state_id, state_code, city, pincode, google_location (http(s) URL ≤1000)}`, `confirm_segment_doc_removal` (bool).
**Rules:** India → `gst_applicable` must be `Yes`; international → `gst_number` is a **TIN**, required, `^[A-Za-z0-9-/. ]{3,30}$`, uppercased; GST number unique per client (vendors + scrutiny). Create sets `status=draft`, `step_completed=1`, allocates `vendor_code`.
**Response 200:** `{ "data": { …shape, "vendor_code": "S-005" } }`
**409:** `{ "requires_doc_confirmation": true, "orphan_documents": [ {id,name,category} ] }` when a removed segment owns unique uploads.
**422:** removed segment mapped to a product / used on a PO or Supplier Invoice; GST/TIN errors.

### 3.4 PUT `/vendors/{id}/step/contacts` (multipart)
`primary_address`* {`contact_name`*, `address_type`, `address_line`, `country_id`, `state_id`, `state_code`, `city`, `pincode`, `google_location`, `designation`, `contact_no` (≤32), `email`, `whatsapp_enabled`, `attachment_path`}, `primary_attachment` (business card). Deletes + re-inserts the primary row; mirrors lower-cased email onto `vendors.primary_email` (globally unique — see §6).

### 3.5 Contacts · Bank accounts · GST scrutiny
- **Contacts** `contact_name`*, `designation`, `contact_no`, `email` (lower-cased), `whatsapp_enabled`, `attachment` / `attachment_path`, `remove_attachment` (update). Primary row unreachable (404). Response `{ data: {…, attachment_url} }` (201 on create).
- **Bank** `bank_name`*, `branch_name`*, `account_number`*, `ifsc`* (stored uppercase), `branch_address`, `cheque` / `cheque_path`. Domestic: IFSC `^[A-Za-z]{4}0[A-Za-z0-9]{6}$`, account 9–18 digits. International: SWIFT 8/11 chars, account 8–34 alphanumeric. Duplicate account number per supplier → 422. Delete is a **force delete**.
- **GST scrutiny** `gst_number`* (≤16, uppercased, unique per client), `status` (`Active|Inactive`), `last_filing_date`, `prev_non_gst_2a_invoice`, `red_flags` (≤2000). Every save rewrites `gst_number` on **all** of the supplier's scrutiny rows. Delete is a force delete.

### 3.6 POST `/vendors/{id}/step/kyc` (multipart, replace-all)
`due_diligence[i]{code, document_name*, issuing_authority, expiry, mandatory, existing_path}` + `dd_files[i]`; `owner_kyc[i]{code, document_name*, issuing_authority, document_number, issue_date, expiry, status, existing_path}` + `owner_files[i]`; `trade_licenses[i]{code, license_type_id, license_number, issuing_authority, issue_date, expiry_date, existing_path}` + `tl_files[i]`. Bank + GST are **not** touched. Sets `step_completed≥2`; `draft → inactive`.

### 3.7 POST `/vendors/{id}/step/products`
`mappings` (present, may be `[]`) of `{product_id*, batch_serial_lot, purchase_price* ≥0, gst_percentage, gst_amount, total_amount}`. Same product twice → 422. Mirrors to `product_vendor_maps`; flips mapped products to `active`. Non-empty → supplier `step_completed=4`, `status=active`.

### 3.8 DELETE `/vendors/{id}`
→ `{ "id": 12, "deleted": true }`. Soft delete; all files on disk removed; master-bundle cache bumped.

---

## 4. ERROR EXAMPLES
**422 — GST already held by another supplier**
```json
{ "message": "GST number 27ABCDE1234F1Z5 is already registered to another supplier.",
  "errors": { "gst_number": ["This GST number is already registered to another supplier."] } }
```
**422 — Indian supplier without GST**
```json
{ "message": "GST is mandatory for an Indian supplier — set GST Applicable to Yes.",
  "errors": { "gst_applicable": ["GST is mandatory for an Indian supplier."] } }
```

---

## 5. QUICK REFERENCE

```
GET  /vendors?scope=domestic&q=acme&page=1     # list + facets
GET  /vendors?light=1                          # picker shape
POST /vendors/step/identity                    # create → S-### allocated
PUT  /vendors/{id}/step/contacts               # primary contact (POST + _method=PUT)
POST /vendors/{id}/bank-accounts               # bank row (independent)
POST /vendors/{id}/step/kyc                    # DD / owner KYC / licences → inactive
POST /vendors/{id}/step/products               # mappings → active
DELETE /vendors/{id}                           # soft delete + file purge
```

---

## 6. NOTES (caveats)
1. No server-side `p2p.supplier` permission check — any authenticated user in scope can call every endpoint.
2. `primary_email` uniqueness is **system-wide** (scope `vendor`, `tenant => false`, shared with `p2p_suppliers.email`).
3. `vendor_code` is per client **and branch**; soft-deleted codes stay reserved.
4. The SPA never calls `PUT/DELETE /gst-scrutiny` or `DELETE /vendors/{id}`.
5. Currency locks (`vendor_currency_locks`) are written by the PO flow, not by any `/vendors` endpoint.

---

## 7. PAGINATION (`GET /vendors`)

| Param | Notes |
|---|---|
| `page` | 1-based |
| `per_page` | Default **24** server-side, **no cap**. The SPA sends 10–50 (auto-fit ≥ 10, or 10/25/50 picked) |
| `q`, `scope`, `tab`, `categories`, `compliance`, `status`, `branch_id` | Applied **before** paging; `categories`/`compliance` are applied **after** facet counting |

**Response meta** (Laravel paginator): `current_page, from, to, last_page, per_page, total, first_page_url, last_page_url, next_page_url, prev_page_url, path, links[]`, plus `facets{grand_total, category{star, general, high_risk, blacklisted}, compliance{compliant, non_compliant}}` — counted over all scoped rows, not the page. Sort: `id DESC`.

All other supplier endpoints are **unpaginated** (full list).

---

## 8. SUPPLIER PICKER ENDPOINTS

All of them use `Vendor::forUser()` (tenant/branch scope, trashed excluded) and **none** filters on status, step or category. ✓ = honours the injected `branch_id`.

| Endpoint | Params | Sort | Returned per row | Used by |
|---|---|---|---|---|
| `GET /vendors?light=1` ✓ | `light=1` | company_name | id, db_id, vendor_code, company_name, country, mobile, primary_email | CLM Case-to-Case counterparty, Payment Request vault lookup |
| `GET /products/master-bundle` (key `vendors`) | — | id desc | id, vendor_code, company_name, website, primary_email, status, vendor_type_name, segment_ids, state, primary_address | Product → Map Supplier |
| `GET /p2p/suppliers` ✓ | — | company_name | id, code, name, segment, contact, mobile, email, country, region | Bulk Sourcing → Map Supplier |
| `GET /p2p/sourcing-targets/{t}/products/{p}/suppliers` | — | latest | mapping snapshot + source | Mapped Suppliers popup |
| `GET /p2p/purchase-orders/suppliers` ✓ | — | company_name | id, code, name, document_type, supplier_type, supplier_category | Create PO (both screens) |
| `GET /p2p/purchase-orders/suppliers/{id}` ✓ | `refresh_currencies` | — | detail + `mapped_product_ids` + Zoho currency | Create PO auto-fill |
| `GET /p2p/supplier-purchase-invoices/suppliers` ✓ | — | company_name | id, code, name, document_type | Map SPI (without PO), SpiDetail |
| `GET /products/{id}/vendor-maps` | — | id | product_vendor_maps rows (`[]` for department-hidden users) | Sales Matrix Vendor Count popup |
| `GET /clm/supplier-profile` | — | id | bucketed rows | CLM Supplier Profile |
| `GET /master/vendor_directory` ✓ | — | id desc | separate `master_vendor_directory` table | Assets master "Supplier" field |

---

*Related documents: SUPPLIER_TECHNICAL_DOCUMENTATION.md · SUPPLIER_FUNCTIONAL_DOCUMENTATION.md · SUPPLIER_CODE_WALKTHROUGH.md*
