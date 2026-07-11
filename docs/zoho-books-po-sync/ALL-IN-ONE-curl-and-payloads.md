# ALL-IN-ONE · Every curl + payload (start → end)

The complete PO → Zoho Books flow as copy-paste curl commands with full payloads.
Runnable top to bottom. Set the variables once, then go.

> Org `60077655856` · India DC (`.in`). Uses `curl` + Git Bash / Linux syntax.
> Secrets are placeholders — paste your real values.

---

## 0 · Set variables (run this block first)

```bash
# ── Zoho OAuth / org ──
export ACCOUNTS_URL="https://accounts.zoho.in"
export ZOHO_BASE="https://www.zohoapis.in/books/v3"
export ORG_ID="60077655856"
export CLIENT_ID="1000.7C0W4U5BDJIARXMCYJTCXNPLQ07LDU"
export CLIENT_SECRET="PASTE_CLIENT_SECRET"
export GRANT_CODE="PASTE_10MIN_CODE"        # from Self Client → Generate Code (scope ZohoBooks.fullaccess.all)
export REFRESH_TOKEN="PASTE_REFRESH_TOKEN"  # produced in step 1
export ACCESS_TOKEN="PASTE_ACCESS_TOKEN"    # produced in step 2

# ── App API ──
export APP_BASE="http://127.0.0.1:8000/api"
export SANCTUM="PASTE_SANCTUM_BEARER_TOKEN"
export PO_ID="4"
```

---

# PART 1 — TOKEN GENERATION

## 1.1 · Exchange grant code → refresh token (one time)

```bash
curl -X POST "$ACCOUNTS_URL/oauth/v2/token" \
  -d "grant_type=authorization_code" \
  -d "client_id=$CLIENT_ID" \
  -d "client_secret=$CLIENT_SECRET" \
  -d "code=$GRANT_CODE"
```
Response → copy `refresh_token` into `.env` (`ZOHO_BOOKS_REFRESH_TOKEN`) and into `REFRESH_TOKEN` above:
```json
{ "access_token":"1000.aaa...","refresh_token":"1000.bbb...","scope":"ZohoBooks.fullaccess.all",
  "api_domain":"https://www.zohoapis.in","token_type":"Bearer","expires_in":3600 }
```

## 1.2 · Refresh → access token (repeat every ~1h)

```bash
curl -X POST "$ACCOUNTS_URL/oauth/v2/token" \
  -d "grant_type=refresh_token" \
  -d "client_id=$CLIENT_ID" \
  -d "client_secret=$CLIENT_SECRET" \
  -d "refresh_token=$REFRESH_TOKEN"
```
Copy `access_token` into `ACCESS_TOKEN`.

---

# PART 2 — ZOHO BOOKS API

All calls send `?organization_id=$ORG_ID` and header `Authorization: Zoho-oauthtoken $ACCESS_TOKEN`.

## 2.1 · Organizations (confirm connection + home state)

```bash
curl "$ZOHO_BASE/organizations?organization_id=$ORG_ID" \
  -H "Authorization: Zoho-oauthtoken $ACCESS_TOKEN"
```
```json
{ "code":0, "organizations":[
  { "organization_id":"60077655856","name":"Inorbvict Agrotech Pvt Ltd",
    "currency_code":"INR","gst_no":"27AADCI6120M1ZH" } ] }
```
`gst_no[0:2]="27"` → home state Maharashtra (drives intra/inter).

## 2.2 · Taxes (GST%→tax_id map)

```bash
curl "$ZOHO_BASE/settings/taxes?organization_id=$ORG_ID" \
  -H "Authorization: Zoho-oauthtoken $ACCESS_TOKEN"
```
```json
{ "code":0, "taxes":[
  { "tax_id":"...","tax_name":"GST18","tax_percentage":18,"tax_type":"tax_group" },
  { "tax_id":"...","tax_name":"IGST18","tax_percentage":18,"tax_type":"tax" },
  { "tax_id":"...","tax_name":"GST5","tax_percentage":5,"tax_type":"tax_group" } ] }
```
Intra → `GSTxx` (tax_group). Inter → `IGSTxx` (tax).

## 2.3 · Currencies (non-INR only)

```bash
curl "$ZOHO_BASE/settings/currencies?organization_id=$ORG_ID" \
  -H "Authorization: Zoho-oauthtoken $ACCESS_TOKEN"
```

## 2.4 · Contact (vendor) — find

```bash
curl -G "$ZOHO_BASE/contacts" \
  -H "Authorization: Zoho-oauthtoken $ACCESS_TOKEN" \
  --data-urlencode "organization_id=$ORG_ID" \
  --data-urlencode "contact_name=fit nation umred" \
  --data-urlencode "contact_type=vendor"
```

## 2.5 · Contact (vendor) — create

Registered vendor (has GSTIN → tax flows):
```bash
curl -X POST "$ZOHO_BASE/contacts?organization_id=$ORG_ID" \
  -H "Authorization: Zoho-oauthtoken $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "contact_name": "fit nation umred",
    "company_name": "fit nation umred",
    "contact_type": "vendor",
    "gst_treatment": "business_gst",
    "gst_no": "27ABCDE1234F1Z5",
    "place_of_contact": "MH",
    "contact_persons": [
      { "first_name": "Contact", "email": "vendor@example.com", "phone": "9999999999", "is_primary_contact": true }
    ]
  }'
```
Unregistered vendor (no GSTIN → PO must be tax-free): use instead
```json
{ "contact_name": "...", "company_name": "...", "contact_type": "vendor", "gst_treatment": "business_none", "place_of_contact": "MH" }
```
Response → save `contact.contact_id` as the PO's `vendor_id`.

## 2.6 · Item (product) — find

```bash
curl -G "$ZOHO_BASE/items" \
  -H "Authorization: Zoho-oauthtoken $ACCESS_TOKEN" \
  --data-urlencode "organization_id=$ORG_ID" \
  --data-urlencode "name=FCV Tobacco Leaf Grade L2"
```

## 2.7 · Item (product) — create (purchasable)

```bash
curl -X POST "$ZOHO_BASE/items?organization_id=$ORG_ID" \
  -H "Authorization: Zoho-oauthtoken $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "FCV Tobacco Leaf Grade L2",
    "product_type": "goods",
    "item_type": "sales_and_purchases",
    "rate": 653210.88,
    "purchase_rate": 653210.88
  }'
```
Response → save `item.item_id`.

## 2.8 · Purchase order — create

```bash
curl -X POST "$ZOHO_BASE/purchaseorders?organization_id=$ORG_ID" \
  -H "Authorization: Zoho-oauthtoken $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "vendor_id": "3981724000000050001",
    "date": "2026-07-11",
    "delivery_date": "2026-07-20",
    "reference_number": "PO/2026-27/004",
    "terms": "Terms & Conditions text",
    "shipping_charge": 0,
    "line_items": [
      { "item_id": "ITEM_ID_1", "name": "FCV Tobacco Leaf Grade L2", "description": "P-97",
        "rate": 653210.88, "quantity": 12, "tax_id": "GST12_TAX_ID" },
      { "item_id": "ITEM_ID_2", "name": "Iron Ore Fines Fe62%", "description": "P-91",
        "rate": 483255.04, "quantity": 1, "tax_id": "GST28_TAX_ID" }
    ]
  }'
```
Rules: omit `tax_id` for an unregistered vendor. Packaging+Other → `adjustment` +
`adjustment_description`. Non-INR → add `currency_id` + `exchange_rate`.
```json
{ "code":0, "message":"Purchase Order has been added.",
  "purchaseorder":{ "purchaseorder_id":"3981...","purchaseorder_number":"PO-00007",
    "sub_total":8321785.60,"tax_total":1075935.08,"total":9397720.68 } }
```

## 2.9 · Purchase order — get

```bash
curl "$ZOHO_BASE/purchaseorders/PO_ZOHO_ID?organization_id=$ORG_ID" \
  -H "Authorization: Zoho-oauthtoken $ACCESS_TOKEN"
```

## 2.10 · Purchase order — get PDF

```bash
curl "$ZOHO_BASE/purchaseorders/PO_ZOHO_ID?organization_id=$ORG_ID&accept=pdf" \
  -H "Authorization: Zoho-oauthtoken $ACCESS_TOKEN" \
  -o zoho-po.pdf
```

## 2.11 · Purchase order — delete

```bash
curl -X DELETE "$ZOHO_BASE/purchaseorders/PO_ZOHO_ID?organization_id=$ORG_ID" \
  -H "Authorization: Zoho-oauthtoken $ACCESS_TOKEN"
```

---

# PART 3 — APP PO API

All send `Authorization: Bearer $SANCTUM`.

## 3.1 · List POs

```bash
curl -G "$APP_BASE/p2p/purchase-orders" \
  -H "Authorization: Bearer $SANCTUM" \
  --data-urlencode "tab=without" --data-urlencode "page=1" --data-urlencode "per_page=10"
```

## 3.2 · Show one PO

```bash
curl "$APP_BASE/p2p/purchase-orders/$PO_ID" \
  -H "Authorization: Bearer $SANCTUM"
```

## 3.3 · Create PO

```bash
curl -X POST "$APP_BASE/p2p/purchase-orders" \
  -H "Authorization: Bearer $SANCTUM" \
  -H "Content-Type: application/json" \
  -d '{
    "po_type": "Material / Goods",
    "document_type": "Domestics",
    "po_date": "2026-07-11",
    "expected_delivery_date": "2026-07-20",
    "vendor_id": 26,
    "currency_code": "INR",
    "exchange_rate": 1,
    "terms": "Terms & Conditions",
    "shipping_charges": 0,
    "packaging_charges": 0,
    "other_charges": 0,
    "items": [
      { "product_id": 97, "product_code": "P-97", "product_name": "FCV Tobacco Leaf Grade L2", "quantity": 12, "rate": 653210.88, "gst_pct": 12 },
      { "product_id": 91, "product_code": "P-91", "product_name": "Iron Ore Fines Fe62%", "quantity": 1, "rate": 483255.04, "gst_pct": 28 }
    ]
  }'
```

## 3.4 · Update PO (blocked once synced → 422)

```bash
curl -X PUT "$APP_BASE/p2p/purchase-orders/$PO_ID" \
  -H "Authorization: Bearer $SANCTUM" \
  -H "Content-Type: application/json" \
  -d '{ "po_type": "Material / Goods", "items": [] }'
```

## 3.5 · Sync PO → Zoho Books

```bash
curl -X POST "$APP_BASE/p2p/purchase-orders/$PO_ID/sync" \
  -H "Authorization: Bearer $SANCTUM"
```
```json
{ "status":true, "message":"Synced to Zoho Books (PO-00007).", "data":{ "po":"PO/2026-27/004","zoho":"Sync" } }
```

## 3.6 · Get Zoho PDF (cached)

```bash
curl "$APP_BASE/p2p/purchase-orders/$PO_ID/zoho-pdf" \
  -H "Authorization: Bearer $SANCTUM" -o zoho-po.pdf
```

---

# Error cheat-sheet

| Message | Fix |
|---|---|
| `invalid_code` | grant code expired → regenerate (2.x needs a fresh code) |
| `401 code 57` on items | scope → regenerate refresh token with `ZohoBooks.fullaccess.all` |
| `cannot be created for a non-purchase item` | send `item_id` (create item first) |
| `Reverse charge should be applied … unregistered vendors` | vendor `business_none` → send PO **without** `tax_id` |
| `IGST cannot be applied … intrastate transaction` | intra → use `GSTxx` group tax id, not IGST |
| `No … tax at X% configured` | enable GST / add rate in Zoho Settings → Taxes |
| app `503 not connected` | fill `.env` `ZOHO_BOOKS_*` + `php artisan config:clear` |
| app `422 PO is locked` | PO already synced — cannot edit |
