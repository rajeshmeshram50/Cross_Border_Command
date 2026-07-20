# Zoho Books — Where Each Record Is Stored

One-page reference. Only these six mappings.

| # | App record | Stored in Zoho Books as | Trigger / endpoint | Zoho API call | Local ref column |
|---|---|---|---|---|---|
| 1 | **Vendor** | **Vendor** (Contact, `contact_type=vendor`) | created on first PO sync | `POST /contacts` | `vendors.zoho_contact_id` |
| 2 | **Product** | **Item** | created on first sync that uses it | `POST /items` | `products.zoho_item_id` |
| 3 | **Purchase Order** | **Purchase Order** | `POST /api/p2p/purchase-orders/{id}/sync` | `POST /purchaseorders` | `purchase_orders.zoho_purchaseorder_id` |
| 4 | **PO Payment** | **Vendor Payment on the Bill** | pushed during the Bill sync | `POST /vendorpayments` | `po_payments.zoho_payment_id` |
| 5 | **SPI Payment** | **Vendor Payment on the Bill** | pushed during the Bill sync | `POST /vendorpayments` | `spi_payments.zoho_payment_id` |
| 6 | **Debit Note** | **Vendor Credit** | `POST /api/p2p/debit-notes/{id}/sync` | `POST /vendorcredits` (then applied to the bill) | `debit_notes.zoho_vendorcredit_id` |

**Rules**
- **Vendor → Vendor**, **Product → Item**, **PO → Purchase Order**, **Debit Note → Vendor Credit** — one-to-one.
- **PO Payment and SPI Payment → Vendor Payment on the Bill** — both are recorded as vendor payments against the Bill.
- Vendors, items and payments are **deduped** (the Zoho id is cached on the local row and reused, never created twice).

_Service: `app/Services/ZohoBooksService.php` — `findOrCreateVendorId`, `findOrCreateItemId`, `createPurchaseOrder`, `recordVendorPayment`, `createVendorCredit`._
