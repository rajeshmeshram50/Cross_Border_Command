# P2P Service Management — API Documentation

## 0. How to read this

| | |
|---|---|
| Base URL | `/api` |
| Auth | `Authorization: Bearer <sanctum token>` |
| Middleware | `auth:sanctum` → `user.active` → `tenant` |
| Controller | `App\Http\Controllers\Api\P2p\ServiceController` |
| Prefix | `/p2p/services` |
| Supplier-side mirror | `VendorController` — `/vendors/{id}/service-mappings`, `/vendors/{id}/step/services` (§6) |

**Envelope.** Item endpoints return the object itself (no `data` wrapper). The
list is Laravel's paginator plus a `counts` block. Errors:

| Status | When | Body |
|---|---|---|
| 401 | No / expired token | `{ "message": "Unauthenticated." }` |
| 403 | Tenant / tier refuses an edit | `{ "message": "<denial text>" }` |
| 404 | Service or mapping not visible to the caller | `{ "message": "Service not found." }` / `"Supplier mapping not found for this service."` |
| 422 | Validation | `{ "message": "...", "errors": { "<field>": ["..."] } }` |

**Visibility.** Every `{id}` is looked up through the caller's scope. A service
outside it is a **404, not a 403** — the API does not confirm it exists.

**Field values.**

| Field | Values |
|---|---|
| `service_type` | `self_consumable` · `soft_digital` · `other_operational` |
| `classification` (self) | `trackable` · `consumable` |
| `classification` (other) | `professional` · `utility` · `facility` · `maintenance` · `outsourcing` |
| `classification` (soft) | always `null` |
| `status` | `draft` · `active` · `inactive` |
| supplier `origin` | `domestic` · `international` |
| supplier `status` | `active` · `inactive` |

---

## 1. Lookups

### `GET /p2p/services/master-bundle`

Every dropdown the form needs, in one call. **Active rows only**, read through
the caller's master scope. Cached **5 minutes per user**.

| Query | Rule |
|---|---|
| `only` | Optional, comma-separated subset of the sections below. Unknown names → 422 *"Unknown section(s): x. Allowed: …"* |
| `service_type` | Optional — narrows `service_categories` to that type |

| Section | Shape |
|---|---|
| `service_types` | The type / classification taxonomy (labels, descriptions) |
| `delivery_types` | `["Cloud / SaaS", "On-Premise", "Web / Browser", "Mobile App", "API", "Remote Support", "On-site Support", "Hybrid"]` |
| `billing_frequencies` | `["Monthly", "Quarterly", "Half-yearly", "Yearly", "Per Use", "One-time"]` |
| `haz_types` | `["Non Hazardous", "Hazardous"]` |
| `contract_options` | `[{value:true,label:"Required"},{value:false,label:"Not Required"}]` |
| `service_categories` | `id, name, service_type, classification` |
| `segments` | `id, name, title, regulatory_status` — `"High"` when the segment is *highly* regulated, otherwise `"Low"` |
| `hsn_codes` | `id, hsn_code, description` |
| `uom` | `id, title, short_code, unit_type` |
| `haz_class` | `id, name` |
| `conditions` | `id, title` |
| `packaging_material` | `id, title` |
| `departments` | `id, name, code` |
| `gst_percentage` | `id, percentage` |
| `supplier_origins` | Domestic / International with a note each |
| `currencies` | `id, code, name, symbol, exchange_rate` — **INR excluded** |

### `GET /p2p/services/next-code`

`{ "code": "SVC-108" }` — a **preview** for the caller's client + branch. The
real code is allocated inside the create transaction (§3), so two people may be
shown the same preview.

### `GET /p2p/services/supplier-pool`

Suppliers that can be mapped, paginated, each as a *vendor card*.

| Query | Rule |
|---|---|
| `origin` | `domestic` / `international` — by the supplier's primary-address country (India = domestic) |
| `q` | ≤ 100 chars — company name or vendor code |
| `status` | `active` / `inactive` / `draft` |
| `service_id` | Excludes suppliers **already actively mapped** to that service |
| `service_type` | Only suppliers whose Supplier Type serves this type |
| `classification` | With `service_type` — only that sub-type |
| `per_page` | 1–100, default 20 |
| `page` | ≥ 1 |

```json
{
  "data": [{
    "id": 12, "vendor_code": "VEN-012", "company_name": "Acme IT",
    "status": "active", "supplier_type": "Trackable Services",
    "supplier_service_type": "self_consumable", "supplier_classification": "trackable",
    "origin": "domestic", "country": "India", "state": "Maharashtra",
    "gst_state_code": "27", "city": "Pune", "currency": "INR",
    "contact_person": "R. Shah", "contact_no": "98…"
  }],
  "current_page": 1, "last_page": 3, "per_page": 20, "total": 45,
  "counts": { "domestic": 40, "international": 5 }
}
```

A Supplier Type matches when its `service_type` / `classification` columns
match, **or**, for older types with neither set, when its name is one of:
`Soft Service Provider`, `Trackable Services`, `Consumable Services`,
`Professional Services`, `Utility Services`, `Facility Services`,
`Maintenance Services`, `Outsourcing Services`.

---

## 2. Reading services

### `GET /p2p/services`

| Query | Rule |
|---|---|
| `service_type` | One of the three types |
| `classification` | ≤ 30 chars |
| `status` | `draft` / `active` / `inactive` |
| `supplier` | `mapped` (≥ 1 active mapping) / `zero` (none) |
| `q` | Free text — code, name, description, provider / brand, delivery type, billing frequency, category, segment, HSN code, UOM title or short code, condition, active supplier's name or code. Case-insensitive (`ILIKE`) |
| `sort` | `recent` (default) · `oldest` · `name` |
| `per_page` | 1–200, default 10 |
| `branch_id` | Branch filter for tiers that may switch branch (injected by the frontend on GETs) |

Each row:

```json
{
  "id": 7, "code": "SVC-007", "created_at": "2026-11-20T10:12:00Z",
  "name": "Laptop", "description": "…",
  "service_type": "self_consumable", "service_type_label": "Self-Consumable Services",
  "classification": "trackable", "classification_label": "Trackable",
  "category": null, "segment": "IT Hardware", "provider_brand": "Dell",
  "delivery_type": null, "billing_frequency": null, "department": null,
  "hsn_code": "84713010", "gst_id": 4, "gst_percentage": 18,
  "uom": "PCS", "condition": "New", "contract_required": false,
  "status": "active", "step_completed": 2,
  "primary_image": "p2p/services/images/7/ab12cd34/laptop.png",
  "suppliers_count": 2, "supplier_names": ["Acme IT", "Zen Supplies"]
}
```

Plus, at the top level, `counts` — the tab badges, computed with the same `q`,
`status` and `supplier` filters:

```json
"counts": {
  "self_consumable":   { "total": 60, "trackable": 40, "consumable": 20 },
  "soft_digital":      { "total": 25 },
  "other_operational": { "total": 22, "professional": 8, "utility": 4, "facility": 5, "maintenance": 3, "outsourcing": 2 },
  "all": 107
}
```

`suppliers_count` and `supplier_names` count **active** mappings only.

### `GET /p2p/services/stats`

The `counts` block alone. Accepts `status`, `supplier`, `q`.

### `GET /p2p/services/{id}`

The full service: every column, the label appends, the related masters
(`category`, `segment`, `hsn`, `uom`, `haz_class`, `condition`, `packaging`,
`department`, `gst`, `creator`), `images` (primary first, then `sort_order`),
`attachments`, `suppliers` (**active and inactive**, oldest first, each a
supplier row — §4) and:

```json
"suppliers_summary": {
  "count": 2, "domestic_count": 1, "international_count": 1,
  "inactive_count": 1, "total_amount": 154300.00
}
```

`total_amount` sums the active mappings' `inr_amount` (₹ value).

---

## 3. Writing a service

### `POST /p2p/services/step/core` — Stage 1, create **or** update

`multipart/form-data`. With no `id` it creates; with `id` it updates that
service (201 on create, 200 on update). Returns the full service (as `GET
/{id}`).

**Always**

| Field | Rule | Failure |
|---|---|---|
| `id` | Integer, optional | 404 if not visible · 403 if not editable |
| `service_type` | Required, one of the three | |
| `name` | Required, ≤ 150 | |
| `description` | Required, ≤ 10,000 | |
| `provider_brand` | Required, ≤ 255 | |
| `hsn_id` | Required, active HSN | *"The selected hsn is invalid or inactive."* |
| `uom_id` | Required, active UOM | *"The selected uom is invalid or inactive."* |
| `gst_id` | Required, active GST rate | *"Map a GST % to this service (GST is mandatory)."* |
| `attachment_files[]` | ≤ 10 files · `pdf,doc,docx,xls,xlsx,csv,jpg,jpeg,png,webp` · ≤ 10 MB each | |
| `remove_attachment_ids[]` | Integers | |

**`self_consumable`**

| Field | Rule |
|---|---|
| `classification` | Required — `trackable` / `consumable` |
| `segment_id` | Required, active segment — *"The selected segment is invalid or inactive."* |
| `haz_type` | Required — `Non Hazardous` / `Hazardous` |
| `haz_class_id` | Required if `Hazardous`, active Haz Class |
| `condition_id` | Required, active |
| `packaging_id` | Required, active |
| `confidential_info` | ≤ 2,000 |
| `primary_image_file` | `jpg,jpeg,png,webp` ≤ 2 MB — **required unless the service already has a primary image that is not being removed**: *"A primary image is required for Self-Consumable services."* |
| `secondary_image_files[]` | ≤ 10 · same types / size |
| `remove_image_ids[]` | Integers |

**`soft_digital`**

| Field | Rule |
|---|---|
| `category_id` | Required — a Soft / Digital category |
| `segment_id` | Required, active |
| `delivery_type` | Required — one of `delivery_types` |
| `contract_required` | Boolean — also accepts `"1"`, `"true"`, `"yes"`, `"on"`, `"required"` |
| `remark` | ≤ 2,000 |

**`other_operational`**

| Field | Rule |
|---|---|
| `classification` | Required — one of the five |
| `category_id` | Required — a category of this type **and** this classification |
| `department_id` | Required, active department |
| `billing_frequency` | Required — one of `billing_frequencies` |
| `contract_required` | Boolean (as above) |
| `remark` | ≤ 2,000 |

Category mismatch → `category_id`: *"The selected service category does not
belong to this service type."*

**What the server does on save**

- Empty strings for `classification`, `category_id`, `segment_id`,
  `haz_class_id`, `gst_id` are treated as `null`; `\r\n` in the long texts
  becomes `\n`.
- `gst_percentage` is copied from the GST master — it is **not** accepted from
  the client.
- Fields the type does not own are **nulled** (`contract_required` → `false`);
  `haz_class_id` is nulled unless `Hazardous`; `classification` is `null` for
  Soft / Digital.
- A new service gets `status = draft`, `step_completed = 1`, its code, and the
  caller's `client_id`, `branch_id`, `created_by`.
- If `gst_id` changed on an existing service, **every domestic mapping is
  re-priced** at the new rate.
- For a non-Self-Consumable service, **all images are deleted**. A new primary
  image replaces (deletes) the old primary.

### `PATCH /p2p/services/{id}/status`

```json
{ "status": "active" }        // or "inactive"
```

| Failure | Message |
|---|---|
| `active` before Stage 2 | *"Complete Stage 2 (Map Service Suppliers) before activating this service."* |

Returns `{ id, code, status, message: "Service SVC-007 is now active." }`.

`draft` cannot be set through this endpoint.

---

## 4. Suppliers of a service

### Supplier row

```json
{
  "id": 31, "vendor_id": 12, "vendor_code": "VEN-012", "vendor_name": "Acme IT",
  "supplier_type": "Trackable Services", "origin": "domestic",
  "country": "India", "state": "Maharashtra", "city": "Pune", "contact_person": "R. Shah",
  "currency": "INR", "price": 50000, "exchange_rate": null,
  "gst_id": 4, "gst_percentage": 18, "gst_amount": 9000, "total_amount": 59000,
  "inr_amount": 59000, "remarks": null, "status": "active", "mapped_at": "…"
}
```

### Pricing — the same for every write below

| | Domestic | International |
|---|---|---|
| `origin` | Must be the supplier's own (India ↔ domestic) | |
| `currency` | Ignored — always `INR` | Required, 3 letters, **not INR**; defaults to the country's currency |
| `exchange_rate` | Ignored | > 0, ≤ 99,999.9999; defaults to the Currencies master rate |
| `gst_id` | Must be the **service's** GST (or omitted) | Ignored — none |
| `gst_amount` | `price × service GST% ÷ 100` | 0 |
| `total_amount` | `price + gst_amount` | `price` |
| `inr_amount` | `total_amount` | `price × exchange_rate` |

`price`: required, > 0, ≤ 9,999,999,999.99. The total and ₹ value must not
exceed 999,999,999,999.99.

| Failure | Field | Message |
|---|---|---|
| Wrong side | `origin` | *"This supplier is based in India — map it as a Domestic supplier."* / *"This supplier is based in {country} — map it as an International supplier."* |
| INR on international | `currency` | *"Pick the supplier's currency — an International price is not in ₹."* |
| No rate anywhere | `exchange_rate` | *"Enter the exchange rate (₹ per USD)."* |
| Service has no GST | `gst_id` | *"Map a GST % to this service first (Stage 1) — domestic suppliers use the service GST."* |
| Different GST | `gst_id` | *"The supplier GST must be the service GST (18%, gst_id 4)."* |
| Too large | `price` | *"The total value is too large (max ₹ 999,999,999,999.99). Check the price and exchange rate."* |
| Price missing / ≤ 0 / too big | `price` | *"Enter the supplier's price."* · *"The price must be more than 0."* · *"The price cannot be more than 9,999,999,999.99."* |
| Rate ≤ 0 / too big | `exchange_rate` | *"The exchange rate must be more than 0."* · *"The exchange rate cannot be more than 99999.9999."* |
| Bad currency | `currency` | *"Pick a currency (3-letter code, e.g. USD)."* |
| Vendor not visible | `vendor_id` / `suppliers` | *"Unknown supplier id(s): 12, 15."* |

### `GET /p2p/services/{id}/suppliers`

`{ service: { id, code, name }, data: [supplier rows], summary: {…} }` — active
and inactive.

### `POST /p2p/services/{id}/suppliers` — map one

```json
{ "vendor_id": 12, "origin": "domestic", "price": 50000, "remarks": "AMC" }
```

- Already active for this service → 422 *"This supplier is already mapped to
  the service."*
- Previously **inactive** → that row is re-activated with the new price (200).
- New → created (201).
- Moves a Draft service to **Active** and `step_completed` to 2.

Returns the supplier row plus `service_status`, `step_completed`.

### `PUT /p2p/services/{id}/step/suppliers` — Stage 2, replace the set

```json
{ "suppliers": [
  { "vendor_id": 12, "origin": "domestic", "price": 50000 },
  { "vendor_id": 40, "origin": "international", "price": 1200, "currency": "USD", "exchange_rate": 84.2 }
] }
```

`suppliers` must be **present** (it may be empty). `vendor_id` must be distinct.
Every listed supplier is upserted active; every **other** active mapping is set
**inactive**. The service becomes **`active`**, `step_completed = 2` —
**even with an empty list.** Returns the full service.

### `PATCH /p2p/services/{id}/suppliers/{map}` — re-price one

Any of `price`, `gst_id`, `currency`, `exchange_rate`, `remarks`. Origin is the
mapping's own. Re-runs the pricing above. Returns the supplier row.

### `PATCH /p2p/services/{id}/suppliers/{map}/status`

`{ "status": "inactive" }` (or `active`). This is how the screen **unmaps**.
Returns the supplier row plus the service's `suppliers_count`. It does **not**
re-check pricing or supplier type on re-activation.

---

## 5. Files

Uploaded files are stored under `p2p/services/images/{service_id}/…` and
`p2p/services/attachments/{service_id}/…` and fetched through the shared P2P
file endpoint:

```
GET /p2p/files/download?path=<file_path>[&inline=1]
```

It resolves the path to its `p2p_service_images` / `p2p_service_attachments`
row and refuses another tenant's file: *"You are not allowed to download this
file."* (403).

---

## 6. Supplier-side mapping (Supplier Management)

The same mappings, edited from the supplier instead of the service.

| Route | Does |
|---|---|
| `GET /vendors/{id}/service-mappings` | The supplier's mappings + summary + meta (its type, origin, currency) |
| `POST /vendors/{id}/step/services` | Replace the supplier's set: `{ mappings: [{ service_id, price, … }] }`. Others become inactive. Each service touched moves to Active / Stage 2. |
| `PATCH /vendors/{id}/service-mappings/{map}` | Re-price one |
| `DELETE /vendors/{id}/service-mappings/{map}` | Set it **inactive** (not deleted); returns `service_suppliers_count` |

Unlike the service-side endpoints, **`step/services` checks that the supplier's
type serves the service**:

> *"This supplier's type (Utility Services) does not serve Trackable — SVC-007
> needs a Trackable supplier."*
> *"Set this supplier's Supplier Type first — only a supplier whose type serves
> Trackable can be mapped to SVC-007."*

Duplicate service in one request → *"A service can only be mapped once per
supplier."*

---

## 7. curl quick reference

```bash
T="Authorization: Bearer $TOKEN"; A=https://host/api

# 1. Dropdowns and the next code
curl -H "$T" "$A/p2p/services/master-bundle?only=hsn_codes,uom,gst_percentage,segments"
curl -H "$T" "$A/p2p/services/next-code"

# 2. Stage 1 — create a Soft / Digital service
curl -H "$T" -X POST "$A/p2p/services/step/core" \
  -F service_type=soft_digital -F name="Microsoft 365 Business" \
  -F description="Mail and Office licences" -F provider_brand=Microsoft \
  -F category_id=3 -F segment_id=5 -F delivery_type="Cloud / SaaS" \
  -F hsn_id=11 -F uom_id=2 -F gst_id=4 -F contract_required=1

# 3. Suppliers that can serve it
curl -H "$T" "$A/p2p/services/supplier-pool?service_type=soft_digital&service_id=108&origin=domestic"

# 4. Map one (moves the Draft to Active)
curl -H "$T" -X POST "$A/p2p/services/108/suppliers" \
  -H "Content-Type: application/json" -d '{"vendor_id":12,"origin":"domestic","price":15000}'

# 5. The list, as the screen asks for it
curl -H "$T" "$A/p2p/services?service_type=soft_digital&q=microsoft&per_page=10"

# 6. Unmap, then deactivate the service
curl -H "$T" -X PATCH "$A/p2p/services/108/suppliers/31/status" \
  -H "Content-Type: application/json" -d '{"status":"inactive"}'
curl -H "$T" -X PATCH "$A/p2p/services/108/status" \
  -H "Content-Type: application/json" -d '{"status":"inactive"}'
```
