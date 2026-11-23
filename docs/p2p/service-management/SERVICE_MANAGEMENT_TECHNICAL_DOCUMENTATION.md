# P2P Service Management — Technical Documentation

## 1. Stack

| Layer | |
|---|---|
| Backend | Laravel 12, PHP 8.2 |
| Database | **PostgreSQL** (the code uses `ILIKE` and `pg_advisory_xact_lock`) |
| Storage | `config('filesystems.documents')`, falling back to the default disk |
| Frontend | React 19 + TypeScript, plain CSS files scoped under `.svm-page` / `.svf-*` / `.svs-*` |
| Cache | `Cache::remember` for the master bundle (5 min, per user) |

---

## 2. Architecture

```
 ServiceManagement.tsx (list)
   ├─ ServiceTypeGate.tsx ........ pick type / sub-type
   ├─ ServiceFormModal.tsx ....... Stage 1 fields + Stage 2 (SupplierMapPanel)
   │    ├─ ServiceGstModal.tsx ... map / add / remove GST %
   │    └─ MasterRecordModal / SegmentModal ... "+" quick-add
   └─ ServiceSupplierModal.tsx ... Mapped Service Suppliers popup
            │
            │ serviceApi.ts (every call, FormData for Stage 1)
            ▼
 /api/p2p/services/*  ──► ServiceController
                             │
                             ├─ ServiceSupplierMapping (App\Services\P2p)
                             │     scope · edit denial · vendor card ·
                             │     price fields · stage-2 completion
                             ├─ SupplierPricing (App\Support) — the arithmetic
                             ├─ MasterVisibility — tenant read / edit scope
                             └─ MasterBundleCache — bundle cache key
 /api/vendors/{id}/service-mappings, /step/services ──► VendorController
                             (same ServiceSupplierMapping service)
```

The supplier-mapping rules live in **one service class** so the two entry
points — from the service and from the supplier — cannot drift.

---

## 3. Data model

### `p2p_services`

| Column | Type | Notes |
|---|---|---|
| `id` | bigint PK | |
| `client_id`, `branch_id` | bigint, null | Tenant; set from the creator |
| `created_by`, `updated_by` | bigint, null | |
| `code` | varchar(255) | `SVC-###` · unique per `(client_id, branch_id, code)` |
| `name` | varchar(255) | API caps at 150 |
| `description` | text | API caps at 10,000 |
| `service_type` | varchar(255) | `self_consumable` / `soft_digital` / `other_operational` · indexed |
| `classification` | varchar(255), null | indexed |
| `category_id` | bigint, null | → `master_service_categories` · indexed |
| `segment_id` | bigint, null | → segments master · indexed |
| `hsn_id`, `uom_id` | bigint, null | Required by the API for every type |
| `haz_class_id`, `condition_id`, `packaging_id` | bigint, null | Self-Consumable |
| `department_id` | bigint, null | Other Operational |
| `provider_brand` | varchar(255), null | |
| `delivery_type` | varchar(50), null | Soft |
| `haz_type` | varchar(20), null | Self |
| `billing_frequency` | varchar(255), null | Other |
| `gst_id` | bigint, null | → GST master · indexed |
| `gst_percentage` | numeric(5,2), null | **Snapshot** of the GST rate, server-set |
| `contract_required` | boolean, default `false` | |
| `remark`, `confidential_info` | text, null | |
| `status` | varchar(20), default `'draft'` | |
| `step_completed` | smallint, default `0` | 1 after Stage 1, 2 after Stage 2 |
| `created_at`, `updated_at`, `deleted_at` | timestamp | Soft deletes |

### `p2p_service_suppliers`

| Column | Type | Notes |
|---|---|---|
| `id` | bigint PK | |
| `service_id`, `vendor_id` | bigint | **Unique `(service_id, vendor_id)`** |
| `origin` | varchar(16), default `'domestic'` | |
| `currency_code` | varchar(8), default `'INR'` | |
| `price` | numeric(15,2) | In `currency_code` |
| `exchange_rate` | numeric(14,4), null | International only |
| `gst_id` | bigint, null | Domestic = the service's `gst_id` |
| `gst_percentage` | numeric(5,2) | |
| `gst_amount`, `total_amount` | numeric(15,2) | |
| `inr_amount` | numeric(14,2), null | ₹ value used in every summary |
| `remarks` | text, null | |
| `status` | varchar(20), default `'active'` | indexed |
| `created_by`, `updated_by`, timestamps | | |

Because of the unique pair, **a mapping row is never deleted**: unmapping sets
`status = inactive`, and mapping again reuses the row.

### `p2p_service_images`

`service_id`, `client_id`, `file_path` (255), `original_name`, `is_primary`
(bool), `sort_order` (smallint), timestamps.

### `p2p_service_attachments`

`service_id`, `client_id`, `file_path` (500), `original_name`, `mime_type`
(120), `size` (bigint), `uploaded_by`, timestamps.

### Masters referenced

| Field | Model | Table |
|---|---|---|
| Category | `Masters\ServiceCategory` | `master_service_categories` (`service_type`, `classification`) |
| Segment | `Masters\Segments` | segments master (`regulatory_status`) |
| HSN | `Masters\HsnCodes` | `master_hsn_codes` |
| UOM | `Masters\Uom` | |
| Haz Class | `Masters\HazClass` | |
| Condition | `Masters\Conditions` | |
| Packaging | `Masters\PackagingMaterial` | |
| Department | `Masters\Departments` | |
| GST | `Masters\GstPercentage` | |
| Currency | `Masters\Currencies` | `exchange_rate` used as the default rate |

---

## 4. The type model — `Service` constants

```php
public const TYPE_FIELDS = [
    self::TYPE_SELF  => ['segment_id', 'haz_type', 'haz_class_id', 'condition_id', 'packaging_id', 'confidential_info'],
    self::TYPE_SOFT  => ['category_id', 'segment_id', 'delivery_type', 'contract_required', 'remark'],
    self::TYPE_OTHER => ['category_id', 'department_id', 'billing_frequency', 'contract_required', 'remark'],
];
```

`SWITCHABLE_FIELDS` is the union. On save, every switchable field **not** in the
type's list is set to `null` (`contract_required` to `false`). So a service
that changes type cannot keep a stale field from its old type — the type is the
source of truth for which columns mean anything.

`TYPES` carries the labels and the classification lists; the frontend's
`SVC_TYPES` (`serviceData.ts`) mirrors it for the tabs. The two must be kept in
step by hand.

---

## 5. Code allocation

```php
DB::select('SELECT pg_advisory_xact_lock(?)', [crc32('p2p_services:'.$user->client_id.':'.$user->branch_id)]);
$service->code = $this->nextCode($user->client_id, $user->branch_id);
```

- **Per client + branch**, matching the unique index.
- `nextCode` takes the highest trailing number over **`withTrashed()`** codes +
  1, so a deleted service's code is never handed out again.
- The advisory lock is **transaction-scoped**, keyed per tenant/branch, and
  released on commit. Two simultaneous creates in one branch serialise; creates
  in different branches do not block each other.
- `GET /next-code` runs `nextCode` **without** the lock — it is a preview.

---

## 6. Pricing — `SupplierPricing` + `ServiceSupplierMapping::priceFields`

```php
// Domestic — the service's GST, never the client's
$gst   = round($price * $gstPct / 100, 2);
$total = round($price + $gst, 2);           // inr_amount = total

// International — no GST
$total = $price;
$inr   = round($price * $rate, 2);
```

| Constant | Value |
|---|---|
| `MAX_PRICE` | 9,999,999,999.99 |
| `MAX_RATE` | 99,999.9999 |
| `MAX_AMOUNT` | 999,999,999,999.99 — checked on `total_amount` and `inr_amount` |

**Origin is derived, not chosen.** `vendorCard()` sets `origin` from the
supplier's **primary address country** (anything not `India` is
international). A request that sends the other origin is refused rather than
silently corrected, so the operator learns the supplier's address is the
problem.

**Currency** defaults from `COUNTRY_CURRENCY` (UAE → AED, USA → USD, Germany →
EUR, …, unknown → USD). **Rate** defaults to the Currencies master's
`exchange_rate` for that code (client row preferred over global).

**GST changes re-price.** When `gst_id` changes on Stage 1,
`repriceDomesticSuppliers()` recomputes every domestic mapping (active and
inactive) with the new rate, inside the same transaction. The UI also **locks**
the GST button while domestic suppliers are mapped, so this path is mostly
reached through the API.

`gstSplit()` computes CGST / SGST vs IGST from the supplier's state code and
the branch's home state — but only for the **supplier-side** rows
(`VendorController::serviceMapRow`); the stored mapping keeps a single
`gst_amount`.

---

## 7. Status model

```
            Stage 1 saved              first supplier mapped
  (new) ───────────────► draft ──────────────────────────────► active
                          │      or PUT step/suppliers           │  ▲
                          │                                      │  │ PATCH status
                          └── PATCH status=active: refused       ▼  │
                              (step_completed < 2)            inactive
```

- `completeStageTwo()` sets `step_completed = 2` and flips `draft → active`. It
  is a no-op for a service already past Stage 2 and not draft.
- `PUT step/suppliers` **always** sets `status = active` and
  `step_completed = 2` — including when the supplier list is empty, and
  including on a service that was `inactive`. The screen only reaches it from
  the Edit form, which is disabled for inactive services.
- Nothing in the backend blocks **editing** an inactive service; that rule is
  enforced by the disabled buttons on the list.

---

## 8. Multi-tenancy

### Reading — `ServiceSupplierMapping::services()`

| Caller | Scope |
|---|---|
| `super_admin` | Everything; `branch_id` query narrows it |
| `client_admin` / `client_user` | `client_id IS NULL OR client_id = mine`, plus the branch-switcher filter |
| `branch_user` | `applyBranchScope`: global rows, or my client with `branch_id` null or mine |
| `employee` | **`applyBranchScope`** — the same as a branch user. Services are deliberately *not* given the generic employee rule (rows they created only), so a branch's employees share one catalogue. |

Masters inside the bundle and in validation are read through
`MasterVisibility::applyReadScope`, active rows only.

### Writing — `serviceEditDenial()`

1. An **employee** whose `client_id` and `branch_id` match the service's → allowed.
2. Otherwise `MasterVisibility::hierarchicalDenial()`: own rows allowed; an
   employee is refused anything else (*"You cannot edit this record — employees
   can only manage rows they created themselves."*); other tiers may change rows
   at or below their own tier (Super Admin 5 › Client 4 › Branch 2, where a row
   with no `client_id` is Super Admin tier and one with no `branch_id` is Client
   tier). Above it: *"You cannot edit this record — it was created by a Client
   Admin."* (or *a Super Admin*, *a Client user*, *another Branch*).

The denial is a **403** with the text. A service outside the read scope is a
**404** before the denial is reached.

### Suppliers

`assertVendorsVisible()` re-reads every `vendor_id` through `Vendor::forUser()`;
an id the caller cannot see is a 422 (*"Unknown supplier id(s): …"*), so a
mapping can never point at another tenant's supplier.

### Files

`P2pFileController::download` maps the path prefix to its table, finds the row,
and refuses a different `client_id` (403). Paths with `..` are a 404.

---

## 9. Where every dropdown comes from

| Form field | Endpoint | Source |
|---|---|---|
| Service Category | `GET /master/service_categories?service_type=&classification=&status=Active` | `master_service_categories` |
| Segment / Service Segment | `master-bundle.segments` | segments master (High / Low badge) |
| HSN / SAC Code | `master-bundle.hsn_codes` | `master_hsn_codes` |
| UOM / Unit of Measurement | `master-bundle.uom` | UOM master |
| Haz Class | `master-bundle.haz_class` | |
| Condition | `master-bundle.conditions` | |
| Packaging Material | `master-bundle.packaging_material` | |
| Department / Cost Centre | `master-bundle.departments` | |
| Delivery Type, Billing Frequency, Haz / Non Haz | `master-bundle` | `Service` constants |
| GST % | `GET /master/gst_percentage` (GST modal) | GST master |
| Currency (International) | `master-bundle.currencies` | Currencies master, INR excluded |
| Supplier | `GET /p2p/services/supplier-pool?service_type=&classification=` | Vendors, filtered by Supplier Type |

The **+** quick-add posts to the generic master endpoint through
`MasterRecordModal` (Segments through CLM's `SegmentModal` → `POST
/clm/segments`), then reloads the bundle with `force = true` and selects the new
record if it is Active.

---

## 10. Derived server-side, never accepted from the client

`code`, `client_id`, `branch_id`, `created_by`, `updated_by`, `status` (on
Stage 1), `step_completed`, `gst_percentage`, every supplier amount
(`gst_percentage`, `gst_amount`, `total_amount`, `inr_amount`), the supplier's
`origin` (validated against the address), the currency default and the rate
default.

---

## 11. Frontend vs backend — where they differ

These are deliberate or known gaps; a test that goes straight to the API will
see the backend column.

| Rule | Screen | API |
|---|---|---|
| Image types | PNG, JPG | `jpg, jpeg, png, webp` |
| Attachment types | PDF, PNG, JPG | `pdf, doc, docx, xls, xlsx, csv, jpg, jpeg, png, webp` |
| Attachments per save | One | Up to 10 |
| Name | 2–150 chars **and must contain a letter** | ≤ 150 only |
| Supplier type must serve the service | Pool is filtered by type | **Not re-checked** on `POST /{id}/suppliers` or `PUT step/suppliers` (it is on the supplier-side `step/services`) |
| Edit an inactive service | Disabled | Allowed |
| Empty supplier list on Submit | Allowed — activates the service | Allowed |

The narrower upload types on the screen were introduced because browsers cannot
preview Office files inline; aligning the API (`IMAGE_MIMES`,
`ATTACHMENT_MIMES`) is a backend change that has been requested, not made.

---

## 12. Caching

`master-bundle` is cached for **5 minutes** under
`MasterBundleCache::key('service:master-bundle:v4:'.md5(sections:type), $userId)`.
A master added elsewhere can take up to five minutes to appear here unless the
cache is busted. The frontend also memoises the bundle and categories per page
load (`loadServiceBundle`, `loadServiceCategories`) and forces a refetch after a
quick-add.

---

## 13. Coupling points

| With | How |
|---|---|
| Supplier Management | Same `p2p_service_suppliers` rows, through `/vendors/{id}/step/services`; Supplier Type decides eligibility |
| Service Category master (`/master/service_categories`) | Category list per type / classification; `usageCount()` counts services |
| CLM Segments | Segment list; quick-add uses CLM's `SegmentModal` |
| GST master | Mandatory on every service; domestic pricing |
| Currencies master | Default exchange rates |
| P2P file endpoint | Image / attachment preview and download |
