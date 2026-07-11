# 04 · Sync Flow, Field Mapping & Business Rules

The complete end-to-end sequence, what maps to what, and the GST rules that make
or break reconciliation.

---

## End-to-end sequence

```
User clicks "Zoho Sync"
      │
POST /api/p2p/purchase-orders/{id}/sync
      │
1. Guards
   ├─ auth + tenant scope (assertScope)
   ├─ ZohoBooksService.isConfigured()  ─ no → 503
   ├─ already has zoho_purchaseorder_id ─ yes → return "already synced" (idempotent)
   ├─ has vendor_id                     ─ no → 422
   └─ has ≥1 line item                  ─ no → 422
      │
2. Resolve references (Zoho ids)
   ├─ gstin      = vendor_gst_scrutiny.gst_number (latest)   → registered?
   ├─ orgState   = ZohoBooks org gst_no[0:2] (e.g. "27")
   ├─ interState = vendor.state_code != orgState
   ├─ vendorId   = findOrCreateVendorId(vendor, gstin, stateCode)
   └─ per line: itemId = findOrCreateItemId(name, rate, taxId)
                taxId  = registered ? resolveTaxId(cgst%+sgst%, interState) : null
      │
3. POST /purchaseorders  (buildZohoPayload)
      │
4. On success
   ├─ store zoho_purchaseorder_id, zoho_synced_at, zoho_status="Sync"
   ├─ GET /purchaseorders/{id}?accept=pdf → cache to zoho_pdf_path
   └─ reconcile: |zoho.total − grand_total| > 1 → log warning
      │
5. On Zoho error
   └─ zoho_status="Not Sync", save zoho_error, return 422 with the message
      │
6. PO is now LOCKED (edit button disabled; PUT returns 422)
```

---

## Field mapping (local → Zoho)

### Header

| Local (`purchase_orders`) | Zoho Books | Note |
|---|---|---|
| `code` | `reference_number` | app PO code; Zoho auto-numbers `purchaseorder_number` |
| `vendor_id` → contact | `vendor_id` | find/create Zoho contact |
| `po_date` | `date` | `yyyy-mm-dd` |
| `expected_delivery_date` | `delivery_date` | |
| `currency_code` (≠INR) | `currency_id` | resolved; `exchange_rate` too |
| `terms` | `terms` | |
| `shipping_charges` | `shipping_charge` | native |
| `packaging_charges`+`other_charges` | `adjustment` (+ description) | no native field |

### Line items

| Local item | Zoho `line_items[]` | Note |
|---|---|---|
| `product_name` | `name` + `item_id` | item created/reused |
| `product_code` | `description` | |
| `quantity` | `quantity` | |
| `rate` | `rate` | pre-tax |
| `cgst_pct + sgst_pct` (effective) | `tax_id` | mapped to GST/IGST id; omitted if unregistered |
| cgst/sgst amounts, cost | — | Zoho recomputes |

---

## GST rules (the important part)

### Rule 1 — Registered vs unregistered vendor

| Vendor GSTIN? | `gst_treatment` | Forward GST sent? | Zoho total |
|---|---|---|---|
| **Yes** (`vendor_gst_scrutiny.gst_number`) | `business_gst` | ✅ yes | = app grand_total |
| **No** | `business_none` | ❌ no (Zoho blocks it) | pre-tax (< app total) |

> An unregistered-vendor PO showing a **lower** total in Zoho is **correct** — GST
> law forbids forward CGST/SGST/IGST from an unregistered supplier. Add the
> vendor's GSTIN (via KYC / GST scrutiny) to make tax flow.

### Rule 2 — Intra-state vs inter-state (tax TYPE)

| | Vendor state vs org state | Zoho tax | Example |
|---|---|---|---|
| **Intra** | same (e.g. both `27`) | `GSTxx` group (CGST+SGST) | `GST18` → 9%+9% |
| **Inter** | different (e.g. `36` vs `27`) | `IGSTxx` | `IGST18` → 18% |

Sending the wrong type → `IGST cannot be applied as this is an intrastate transaction`.

### Rule 3 — Tax amount

CGST% = SGST% = **item's own GST ÷ 2** (12% → 6/6, 28% → 14/14). Never hard-coded.
(A past bug forced 9/9 for all Maharashtra POs — fixed 2026-07-11.)

---

## Reconciliation

After create, the app compares Zoho's `total` to the local `grand_total`:

| Case | Result |
|---|---|
| Registered vendor | Match to the paisa (rounding ≤ ₹1) |
| Unregistered vendor | Zoho lower by the GST amount (logged, not an error) |

Verified: `PO/2026-27/004` — app `9,397,720.68` = Zoho `9,397,720.68`.

---

## Edit lock

Once `zoho_purchaseorder_id` is set:
- **Frontend:** Edit (pencil) button disabled, tooltip "Locked — already synced to Zoho Books".
- **Backend:** `PUT /p2p/purchase-orders/{id}` → `422` "This PO is locked…".
- **Re-sync:** returns "already synced" (no duplicate).

---

## Prerequisites checklist

- [ ] `.env` `ZOHO_BOOKS_*` filled + `php artisan config:clear`
- [ ] Refresh token scope = `ZohoBooks.fullaccess.all`
- [ ] GST enabled in Zoho Books (Settings → Taxes → GST Settings) → slabs 5/12/18/28 + IGST exist
- [ ] Vendor has a company/legal name
- [ ] Vendor GSTIN captured (for tax to flow) — else PO syncs pre-tax
- [ ] PO has a supplier + ≥1 line item
