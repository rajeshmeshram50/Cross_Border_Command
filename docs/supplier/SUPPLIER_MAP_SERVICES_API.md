# Supplier Master · Map Services API

The supplier side of `p2p_service_suppliers`. Service Management maps suppliers to a
service (`/p2p/services/{id}/suppliers`); these endpoints map services to a supplier.
**Same table, same row.** A mapping made here is the row the Service screen lists, and
the other way round. There is no second table.

All rules live in `App\Services\P2p\ServiceSupplierMapping` and are shared with
`ServiceController`, so both ends enforce the same thing.

| Method | Path | What it does |
|---|---|---|
| GET | `/api/vendors/{id}/service-mappings` | List every mapping of this supplier (inactive included) |
| POST | `/api/vendors/{id}/step/services` | Save the Map Services step (replace-all) |
| PATCH | `/api/vendors/{id}/service-mappings/{map}` | Change one mapping's price / currency / rate / remarks |
| DELETE | `/api/vendors/{id}/service-mappings/{map}` | Soft unmap (`status = inactive`, row kept) |

## Rules enforced by the server

| Rule | Result when broken |
|---|---|
| The supplier must be visible to the user (`Vendor::forUser`) | 404 |
| The user may edit the supplier (`MasterVisibility::hierarchicalDenial`, as `storeProducts`) | 403 `{message}` |
| The service must be visible to the user (the Service list scope) | 422 `Unknown service id: N.` / 404 for a map |
| The user may edit the service (same check as the Service screen) | 403 `{message: "SVC-001: …"}` |
| The supplier type must serve the service bucket (type + classification) | 422 on `mappings.N.service_id` |
| `origin` must match the supplier's country | 422 on `mappings.N.origin` |
| Domestic needs a GST % on the service (Stage 1); `gst_id` must be the service's | 422 on `mappings.N.gst_id` |
| International: currency is not INR; a rate is given or found in the Currency master | 422 on `currency` / `exchange_rate` |
| The same service twice in one save | 422 `A service can only be mapped once per supplier.` |
| Price > 0 and ≤ 9,999,999,999.99; rate ≤ 99,999.9999; total ≤ ₹ 999,999,999,999.99 | 422 on `price` / `exchange_rate` |

### Supplier type vs service type

The supplier type's bucket is read from `master_vendor_types.service_type` + `classification`.
If those are empty, the type name is used as a fallback (`Soft Service Provider`,
`Trackable Services`, …), exactly as in `ServiceController::supplierPool()`. The supplier
can be mapped only when both the type and the classification match the service's.

| Supplier type | Can map |
|---|---|
| Material / Goods, FFD / Transporter, any `kind = material / logistics` type | nothing (422) |
| Soft Service Provider | Soft / Digital services |
| Trackable Services / Consumable Services | Self-Consumable · Trackable / Consumable |
| Professional / Utility / Facility / Maintenance / Outsourcing Services | Other Operational · that sub-type |
| A type with no bucket (e.g. the legacy `Service Provider`) | nothing (422 — set a fixed type) |

Messages:
- `A Material/ Goods supplier cannot supply a service. Only a supplier whose type serves Soft / Digital Services can be mapped to SVC-001.`
- `This supplier's type (Soft Service Provider) does not serve Trackable — SVC-002 needs a Trackable supplier.`
- `Set this supplier's Supplier Type first — …` (supplier has no type)

### Pricing

Pricing always goes through `App\Support\SupplierPricing`. The client never sends amounts.

- **Domestic**: price is in ₹. GST % comes from the service's `gst_id`, so `gst_amount = price × gst%`,
  `total_amount = price + gst_amount` and `inr_amount = total_amount`.
- **International**: price is in the supplier's currency, with no GST. `total_amount = price` and
  `inr_amount = price × exchange_rate`. The rate is stored on the row, not looked up again later.
  If `currency` is omitted, the currency for the supplier's country is used. If `exchange_rate` is
  omitted, the Currency master rate is used.
- If `origin` is omitted, the supplier's own origin is used.

## GET /api/vendors/{id}/service-mappings

```json
{
  "data": [
    {
      "id": 224,
      "service_id": 10,
      "service_code": "SVC-001",
      "service_name": "Zoom licence",
      "service_type": "soft_digital",
      "service_type_label": "Soft / Digital Services",
      "classification": null,
      "classification_label": null,
      "category": "SaaS Subscription",
      "service_status": "active",
      "vendor_id": 8,
      "origin": "domestic",
      "currency": "INR",
      "price": 1000,
      "exchange_rate": null,
      "gst_id": 4,
      "gst_percentage": 3,
      "gst_amount": 30,
      "total_amount": 1030,
      "inr_amount": 1030,
      "gst_type": "inter",
      "cgst_amount": 0,
      "sgst_amount": 0,
      "igst_amount": 30,
      "remarks": null,
      "status": "active",
      "mapped_at": "2026-11-20T10:00:00.000000Z"
    }
  ],
  "summary": { "count": 1, "domestic_count": 1, "international_count": 0, "inactive_count": 0, "total_amount": 1030 },
  "meta": {
    "vendor_id": 8, "vendor_code": "S-008", "vendor_name": "…",
    "supplier_type": "Soft Service Provider",
    "supplier_service_type": "soft_digital", "supplier_classification": null,
    "origin": "domestic", "country": "India", "currency": "INR"
  }
}
```

- The pricing fields (`origin … inr_amount`, `remarks`, `status`) have the same names and types as the
  Service screen's `ApiSupplierRow` (`serviceApi.ts`). The existing `supplierFromApi` mapping works
  unchanged for them. The service fields take the place of the vendor fields.
- `summary` has the same shape as the service side's `suppliers_summary`. `total_amount` is the ₹ sum
  of the active rows.
- `meta.supplier_service_type` / `supplier_classification` tell the UI which services to offer.
  Use them to filter the service picker. The server enforces the same rule anyway.
- `gst_type` / `cgst_amount` / `sgst_amount` / `igst_amount` are **worked out when the list is read**
  (supplier state vs the branch's GST state). They are not stored. See *Schema gaps*.
- Inactive rows are included. Filter on `status !== 'inactive'` for the mapped list, as
  `fetchServiceSuppliers()` does.

## POST /api/vendors/{id}/step/services

This is a replace-all save, like `step/products` and the service side's Stage 2.
- Each listed service is mapped. A row that was unmapped earlier is revived, never inserted twice.
- Any other **active** mapping of this supplier is set `inactive`.
- Each mapped service finishes Stage 2: `step_completed ≥ 2`, and a `draft` service becomes `active`
  (`completeStageTwo()`).

```json
{
  "mappings": [
    { "service_id": 10, "origin": "domestic", "price": 1000, "remarks": "Annual plan" },
    { "service_id": 14, "origin": "international", "price": 10, "currency": "USD", "exchange_rate": 85 }
  ]
}
```

| Field | Rule |
|---|---|
| `mappings` | required, array (may be `[]` — turns every mapping off) |
| `mappings.*.service_id` | required, integer, distinct |
| `mappings.*.origin` | `domestic` \| `international`, optional (defaults to the supplier's) |
| `mappings.*.price` | required, > 0 |
| `mappings.*.gst_id` | optional; must equal the service's `gst_id` when sent |
| `mappings.*.currency` | 3-letter code, International only |
| `mappings.*.exchange_rate` | > 0, International only |
| `mappings.*.remarks` | optional, ≤ 1000 chars |

The send shape matches `supplierPayload()` in `serviceApi.ts`, with `service_id` in place of
`vendor_id`. Nothing is saved unless every row passes. Validation errors are keyed `mappings.N.<field>`.

**Response 200:** the same body as GET.

## PATCH /api/vendors/{id}/service-mappings/{map}

```json
{ "price": 2000 }
{ "exchange_rate": 86.25, "remarks": "Rate revised" }
```

`price`, `gst_id`, `currency`, `exchange_rate` and `remarks` are all optional. The origin stays as
it is: to change it, unmap and map again. The amounts are recomputed through `SupplierPricing`.

**Response 200:** one row (same shape as a `data[]` item).

## DELETE /api/vendors/{id}/service-mappings/{map}

Soft unmap. It sets `status = inactive` and keeps the row, so a later map of the same service revives it.
Calling it again on an inactive row is a no-op (200).

**Response 200:** the row with `"status": "inactive"` and `service_suppliers_count` (the service's
active suppliers left).

## Schema gaps (nothing migrated yet)

1. **The GST split is not stored.** `p2p_service_suppliers` has `gst_amount` but no `gst_type`,
   `cgst_amount`, `sgst_amount` or `igst_amount`. The split is worked out on read in this API. The
   service-side API does not return it at all. Storing it needs 4 columns on `p2p_service_suppliers`
   plus a backfill. The total is the same either way, because the split only divides `gst_amount`.
2. **The supplier's own step has no slot for services.** `vendors.step_completed` runs 1–4, and
   step 4 (products) is the one that sets the supplier `active`. Saving Map Services does not touch
   the supplier's status or step, so a services-only supplier stays at its current step. Decide:
   should Map Services count as the last step for a service supplier, or should it be a step 5?
3. **No price history.** There is one row per (service, supplier) (unique index), so a re-price or a
   re-map overwrites the old price. `updated_by` / `updated_at` are the only trail.
4. **The service side does not check the supplier type.** `ServiceController::storeSupplier()` /
   `storeSuppliers()` only filter the dropdown (`supplierPool`). The API accepts any visible supplier,
   so rows that break the type rule can exist. This API refuses them. Adding the same
   `assertServes()` call on the service side is a one-line change per method, but it would change
   existing behaviour, so it was not done here.
5. **Untyped "service" suppliers.** Supplier types with `kind = services` but no `service_type`
   (e.g. global `Service Provider`, id 10) belong to no bucket, so they can map nothing.
