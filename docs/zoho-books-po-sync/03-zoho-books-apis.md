# 03 · Zoho Books APIs (every call the sync makes)

Base: `https://www.zohoapis.in/books/v3` · every request carries
`?organization_id=60077655856` and header `Authorization: Zoho-oauthtoken <access_token>`.
Zoho signals failure via non-2xx **or** a `2xx` body with non-zero `code`.

Implemented in `app/Services/ZohoBooksService.php`.

---

## 0 · Access token (auth)

```
POST https://accounts.zoho.in/oauth/v2/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token&client_id=...&client_secret=...&refresh_token=...
```
→ `{ "access_token": "...", "expires_in": 3600 }` (cached ~55 min).

## 1 · Organizations — confirm connection / home state

```
GET /organizations?organization_id=60077655856
```
```json
{ "code": 0, "organizations": [
  { "organization_id": "60077655856", "name": "Inorbvict Agrotech Pvt Ltd",
    "currency_code": "INR", "gst_no": "27AADCI6120M1ZH" } ] }
```
`gst_no[0:2] = "27"` → org home state = Maharashtra (drives intra/inter).

## 2 · Taxes — build GST%→tax_id map

```
GET /settings/taxes?organization_id=60077655856
```
```json
{ "code": 0, "taxes": [
  { "tax_id": "...", "tax_name": "GST18",  "tax_percentage": 18, "tax_type": "tax_group" },
  { "tax_id": "...", "tax_name": "IGST18", "tax_percentage": 18, "tax_type": "tax" },
  { "tax_id": "...", "tax_name": "GST5",   "tax_percentage": 5,  "tax_type": "tax_group" }
  ] }
```
- **Intra-state** (vendor state = org state) → use `GSTxx` (`tax_group`, CGST+SGST).
- **Inter-state** → use `IGSTxx` (`tax`).
- Prereq: enable GST in Zoho (Settings → Taxes → GST Settings) so these exist.

## 3 · Currencies — resolve non-INR

```
GET /settings/currencies?organization_id=60077655856
```
```json
{ "code": 0, "currencies": [ { "currency_id": "...", "currency_code": "USD" } ] }
```
INR (org base) is omitted from the payload.

## 4 · Contacts (vendor) — find or create

**Find by name** (avoid duplicates):
```
GET /contacts?organization_id=60077655856&contact_name=fit%20nation%20umred&contact_type=vendor
```

**Create** (`POST /contacts`):
```json
{
  "contact_name": "fit nation umred",
  "company_name": "fit nation umred",
  "contact_type": "vendor",
  "gst_treatment": "business_gst",          // "business_none" if no GSTIN
  "gst_no": "27ABCDE1234F1Z5",              // only when registered
  "place_of_contact": "MH",                 // GST state code → 2-letter
  "contact_persons": [
    { "first_name": "...", "email": "...", "phone": "...", "is_primary_contact": true }
  ]
}
```
```json
{ "code": 0, "contact": { "contact_id": "3981724000000050001" } }
```
The `contact_id` is cached on `vendors.zoho_contact_id`.

> **`gst_treatment` rule:** `business_gst` (with `gst_no`) when the vendor has a
> GSTIN → forward GST allowed. `business_none` when it doesn't → Zoho **rejects
> forward tax** ("Reverse charge should be applied … unregistered vendors"), so
> the PO is sent **tax-free**.

## 5 · Items (products) — find or create purchasable

Zoho POs reject ad-hoc lines ("cannot be created for a non-purchase item"), so
each product must exist as a **purchasable Item**.

**Find:** `GET /items?organization_id=...&name=<product name>`

**Create** (`POST /items`):
```json
{
  "name": "FCV Tobacco Leaf Grade L2",
  "product_type": "goods",
  "item_type": "sales_and_purchases",   // makes it valid on a PO
  "rate": 653210.88,
  "purchase_rate": 653210.88,
  "tax_id": "<optional>"
}
```
```json
{ "code": 0, "item": { "item_id": "3981724000000xxxxx" } }
```

## 6 · Purchase order — create

```
POST /purchaseorders?organization_id=60077655856
```
Payload built by `PurchaseOrderController::buildZohoPayload()`:
```json
{
  "vendor_id": "3981724000000050001",
  "date": "2026-07-11",
  "delivery_date": "2026-07-20",
  "reference_number": "PO/2026-27/004",
  "terms": "Terms & Conditions text",
  "shipping_charge": 0,
  "line_items": [
    { "item_id": "...", "name": "FCV Tobacco Leaf Grade L2", "description": "P-97",
      "rate": 653210.88, "quantity": 12, "tax_id": "<GST12 id>" },
    { "item_id": "...", "name": "Iron Ore Fines Fe62%", "description": "P-91",
      "rate": 483255.04, "quantity": 1, "tax_id": "<GST28 id>" }
  ]
}
```
Notes:
- `tax_id` is **omitted** when the vendor is unregistered (tax-free PO).
- Packaging + Other charges (no native Zoho field) fold into `adjustment` +
  `adjustment_description`.
- Non-INR: add `currency_id` + `exchange_rate`.

Response:
```json
{ "code": 0, "message": "Purchase Order has been added.",
  "purchaseorder": { "purchaseorder_id": "3981724000000xxxxx",
    "purchaseorder_number": "PO-00007", "sub_total": 8321785.60,
    "tax_total": 1075935.08, "total": 9397720.68 } }
```
`total` is reconciled against the app's `grand_total` (delta > ₹1 is logged).

## 7 · Purchase-order PDF — fetch & cache

```
GET /purchaseorders/{purchaseorder_id}?organization_id=60077655856&accept=pdf
```
Returns raw PDF bytes → saved to `storage/app/public/zoho/po/PO-<code>.pdf`
(`purchase_orders.zoho_pdf_path`). Served back via the app's `/zoho-pdf` route.

## 8 · Delete (cleanup / re-sync)

```
DELETE /purchaseorders/{purchaseorder_id}?organization_id=60077655856
```

---

## Error reference (real ones we hit)

| Zoho message | Cause | Resolution |
|---|---|---|
| `You are not authorized… (code 57)` on items | granular scope | use `ZohoBooks.fullaccess.all` |
| `Purchase order cannot be created for a non-purchase item` | ad-hoc line | create a purchasable **item**, send `item_id` |
| `Reverse charge should be applied … unregistered vendors` | vendor `business_none` + forward tax | send PO tax-free for unregistered vendors |
| `IGST cannot be applied as this is an intrastate transaction` | wrong tax type | intra → `GSTxx` group, inter → `IGSTxx` |
| `No … tax at X% is configured` | GST slab missing in Zoho | enable GST / add the rate in Settings → Taxes |
