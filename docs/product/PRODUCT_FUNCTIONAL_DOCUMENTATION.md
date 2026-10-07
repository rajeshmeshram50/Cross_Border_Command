# PRODUCT MODULE — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · P2P → Master Management → Product Management

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-10-06 | System | Initial functional documentation |
| 1.1 | 2026-10-07 | System | Added dropdown conditions, pagination, product card |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
The Product module is the branch's **product catalogue**: every item the company buys and sells. Each product holds its classification (segment, HSN, UOM, hazard, condition, packaging), images and spec attachment, selling price + GST, and the **suppliers** mapped to it with their purchase prices. The Sales Matrix, Quotations/PIs, Purchase Orders, Supplier Purchase Invoices, Bulk Sourcing and the Zoho Books item sync all pick products from this list.

### 1.2 Business value
| Benefit | Description |
|---|---|
| One catalogue | A single branch-shared product list used by Sales and Purchase |
| Supplier readiness | Each product shows how many suppliers can supply it, with purchase price + GST |
| Margin protection | Purchase staff never see selling prices; Sales staff never see suppliers or cost |
| Tax consistency | Supplier GST always equals the product's GST; GST is locked once used on a PO/PI/SPI |
| Compliance by segment | A supplier can only be mapped to a product in a segment it deals in |
| Traceability | Auto product codes (`P-001` …) per branch; deleted codes are never reused |

### 1.3 Key features
- **Product list**: card grid, search, filter drawer, two tabs (Supplier Mapped / Zero Supplier), 12 per page by default.
- **Add/Edit product**: Core Information → (Map GST) → Sales Information, with images and an attachment.
- **Map Supplier popup**: add/remove suppliers, purchase price, auto GST/total; a new supplier can be created inline.
- **Product detail view**: gallery, price card, Product Details tiles, description tabs, Mapped Suppliers, QC documents.
- **Usage locks**: segment and GST % changes are blocked once the product is used downstream.

---

## 2. ROLES & ACCESS

The menu entry is the **`p2p.product`** leaf (P2P → Master Management → Product Management, route `/products`). The page itself only opens for **branch users and employees**. Other account types see "Branch / Employee only".

| Role | Access |
|---|---|
| Branch User | Sees globals + client-level + own-branch products; edits own-branch products |
| Employee (any department) | Sees and edits the whole branch catalogue |
| Employee — **Purchase** dept | Selling price, GST and total are hidden ("Tap to view price"); the form ends after Core Information |
| Employee — **Sales** dept | Supplier names, contacts and purchase prices are hidden. The card shows only the supplier **count**, and it can't be clicked |
| Client Admin / Super Admin | API access within their scope; the Products page itself is not offered to them |

> The server does not check a module permission for products. Access depends on the tenant/branch scope and the edit-ownership rule.

---

## 3. BUSINESS PROCESS FLOW

```
┌───────────────────────────────────────────────────────────────────┐
│                        PRODUCT LIFECYCLE                            │
└───────────────────────────────────────────────────────────────────┘
   CORE INFORMATION (Save & Next)
        │  name, generic name, description, brand, segment, haz type/class,
        │  UOM, HSN, condition, packaging, images, attachment
        │  → "Map GST" popup: a GST % must be chosen before the product is created
        │  → product code P-NNN allocated · status = DRAFT
        ▼
   SALES INFORMATION (Save)
        │  selling price (> 0), GST %, GST amount, total, Bottom / Non Bottom
        │  → status DRAFT → INACTIVE  ("ready, zero supplier")
        ▼
   MAP SUPPLIERS (Map Supplier popup — saved immediately)
        │  supplier must deal in the product's segment
        │  GST % forced to the product's GST; total = price + GST
        │  → status = ACTIVE  · supplier auto-activated
        │  → removing the last supplier → back to INACTIVE
        ▼
   IN USE (Sales Matrix leads · Quotation/PI · PO · SPI · Bulk Sourcing · Zoho item)
        │  segment locked once on a customer-linked lead / PO / SPI
        │  GST % locked once on a PO / PI / SPI
        ▼
   DELETE → soft deleted (hidden from lists; code not reused)
```

### 3.1 Add/Edit form
| Section | Captures | Required (UI) |
|---|---|---|
| Core Information | Name (≤100), Generic name, Printable description (≤10,000), Make/Brand/Specifications, Segment, Haz/Non-Haz (+ Haz Class if Haz), UOM, HSN/SAC, Condition, Packaging Material, Confidential info, Primary image, Secondary images (≤10), Product attachment | All except confidential info and attachment; at least one secondary image |
| Map GST | GST % from the GST master (a rate can be added inline) | Yes, on create |
| Sales Information | Selling price, GST, GST amount, Total, Mark Bottom | Selling price > 0 and GST |
| Suppliers | Supplier, contact, purchase price, map date, remarks | Supplier name |

Images: PNG/JPG only, ≤ 2 MB each. Attachment: PDF, Word or image, ≤ 10 MB.

### 3.2 List tabs
| Tab | Shows |
|---|---|
| Supplier Mapped Products (green "Active" badge + count) | Products with ≥ 1 supplier mapping |
| Zero Supplier Products (red "Inactive" badge + count) | Products with no supplier mapping |

The tabs follow **supplier mappings**, not the status field. Badge counts cover the whole filtered catalogue (see §8).

---

## 4. SCREEN SPECIFICATIONS

### 4.1 Product list (`Products.tsx`)
```
┌───────────────────────────────────────────────────────────────────┐
│  Product Management  (hero)                        [Add Product]   │
│  ▸ What We Are Doing Here  (collapsible, Steps 01–05)              │
├───────────────────────────────────────────────────────────────────┤
│  [Supplier Mapped Products ● Active N] [Zero Supplier ● Inactive N]│
│  [Search products by code, name, HSN or segment…]   [Filter (n)]   │
│  Applied: [Segment: Spices ×] [HSN: 0904… ×] … [Clear all]         │
│  ┌card┐ ┌card┐ ┌card┐ ┌card┐   (grid, see §7)                     │
│  Showing 1–12 of 57    Rows per page [12▾]   1 / 5   [‹] [›]       │
└───────────────────────────────────────────────────────────────────┘
```
Filter drawer: Segment, HSN, Haz Class, Condition, Created Date (Last 7 / 30 / 90 days, Custom N days). Inward Count and Invoice Count are shown greyed out because nothing backs them yet. A supplier deep-link `/products?vendor_id=…` adds a "Showing products mapped to supplier …" banner with **Clear filter**.

> The page also has code for a list view, a sort control, and Segment/Status dropdowns, but **no control is rendered to switch to them**. The page always shows the grid sorted newest-first.

### 4.2 Add/Edit Product (`AddProductModal.tsx`)
Two tabs, **Core** and **Sales**, plus the Map GST popup and the Mapped/Map Supplier popups. Inline "+" buttons add masters (segment, GST, etc.) and a complete new supplier.

### 4.3 Product detail (`ProductView.tsx`)
Opens as an overlay from the list (click the card image or title) or at `/products/:id`. Contents: header card (see §7.3), gallery, price card, Product Details tiles, Description / Brand / Confidential tabs, Mapped Suppliers, QC reference documents.

---

## 5. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | Product code `P-NNN` is auto-generated, sequential **per branch**, unique per (client, branch) |
| 2 | Codes of deleted products are never re-issued |
| 3 | A new product is created only after a GST % is mapped |
| 4 | Status: Draft (Core saved) → Inactive (Sales saved) → Active (≥ 1 supplier) |
| 5 | A supplier can only be mapped if it deals in the product's segment |
| 6 | Supplier GST % always equals the product's GST %; changing product GST updates every supplier row |
| 7 | GST % cannot change once the product is on a PO, PI or SPI |
| 8 | Segment cannot change once the product is on a PO/SPI or on a lead tied to a customer |
| 9 | Mapping a supplier activates that supplier |
| 10 | Purchase dept cannot see selling price; Sales dept cannot see supplier details |
| 11 | Employees can edit any product of their own branch; others follow the creator/tier rule |
| 12 | Delete is a soft delete |

---

## 6. STATUS MODEL

| Status | Meaning |
|---|---|
| Draft | Core Information saved; Sales not yet saved |
| Inactive | Sales saved, no supplier mapped (or last supplier removed) |
| Active | At least one supplier mapped via the supplier list save |

The **Active/Inactive pill on cards** does not read this column. It is "Active" when the product has ≥ 1 supplier mapping (see §7).

---

## 7. PRODUCT CARD

### 7.1 Grid card mock-up
```
┌──────────────────────────────────────┐
│ [image or ▢ icon]            [✎]     │  ← click image = open detail; ✎ = Edit
│ [SPICES (segment chip)] [Reg badge]  │
│ [● Active] / [● Inactive]            │
├──────────────────────────────────────┤
│ P-007 | Black Pepper Whole            │  ← click = open detail (tooltip = full)
│ HSN 09041110 │ GST 5% │ 👥 2 Suppliers│  ← Suppliers = opens Mapped Suppliers
│ [⚠ Hazardous: Class 9] / [✓ Non-Hazardous]
├──────────────────────────────────────┤
│ [Add to Wishlist]      [Add to Cart] │  ← placeholders (toast only)
└──────────────────────────────────────┘
```

### 7.2 Grid card fields
| Element | Position | Source field | Format / fallback | Condition / colour |
|---|---|---|---|---|
| Image | Top | `primary_image_url`, else first `secondary_images_url` | Lazy `<img>`; if there's no image or it fails to load, a generic image icon shows | Accent colour per card = fixed palette by product id |
| Segment chip | On image | `segment.title` | Cut at 30 chars + "…" (tooltip = full); `—` if none | Chip background = average colour of the loaded image |
| Regulatory badge | On image corner | `segment.regulatory_status` | `SegmentBadge` | Only when the segment carries a status |
| Status pill | On image | count of supplier mappings (`vendor_count` / `vendor_maps`) | "Active" / "Inactive" | Green if ≥ 1 supplier, else red. **Not** the status column |
| Edit (pencil) | Image, top-right | — | Spinner while the form opens | Always shown; all card buttons disabled while one is opening |
| Code \| Name | Body line 1 | `product_code` + `name` | Code padded to 3 digits (`P-7` → `P-007`); fallback `P-<id>` | Tooltip shows full text |
| HSN | Body line 2 | `hsn.hsn_code` | `—` if none | — |
| GST | Body line 2 | `gst_percentage.percentage` | `N%`; `0%` if none **or hidden** (Purchase dept) | — |
| Suppliers | Body line 2 | supplier count | "N Supplier(s)" | Clickable button for everyone except Sales dept (plain text) |
| Hazard | Body line 3 | `haz_type` + `haz_class.name` | "Hazardous: <class>" or "Hazardous"; else "Non-Hazardous" | Haz = starts with "haz" and does not contain "non" |
| Wishlist / Cart | Footer | — | Toast "<action>: <name>" | No function behind them |

**Not on the grid card:** price, brand, UOM, condition, owner, delete. The card mapping also carries `rating`, `reviews` (always 0), `badge` and `owner*` fields, but none of them are shown or filled with data (owner fields come back empty because the list doesn't load `creator`).

### 7.3 Product detail header card (`ProductView.tsx`)
| Element | Source | Format / fallback |
|---|---|---|
| Title | `product_code` \| `name` | Code padded to 3 digits; name cut at 25 chars + "…" (tooltip = full) |
| Buttons | — | **Edit** (hidden in preview/read-only); **Suppliers** (hidden for Sales dept, preview, read-only); **Back to Product List** / **Close** |
| Main image + thumbnails | primary + secondary URLs | Auto-rotating gallery; placeholder = first letter of name (or "P") |
| Status chip | `vendor_maps.length > 0` | Active (green) / Inactive (red) |
| Price card | `base_price`, `gst_percentage`, `gst_amount`, `total_price`, `uom.short_code` | "Selling Price ₹x/- per UOM", "Base ₹x · GST n% ₹y", "Total incl. GST ₹z/-"; `—` if empty. Purchase dept sees "Tap to view price" (toast "Access denied") |
| Buy bar | — | Qty stepper + Wishlist/Cart toasts (presentation only; hidden when read-only) |
| Detail tiles | HSN, Segment (+ reg badge), Hazardous/Non-Hazardous (+ class), UOM ("Title (SHORT)"), Condition, Packaging Material | `—` fallback |
| Tabs | `description`, `brand`, `confidential_info` | Empty text = "No description provided." etc. |

> For Sales-dept users the API returns an empty `vendor_maps`, so the detail chip **always reads "Inactive"** for them, even when the list card says Active.

---

## 8. PAGINATION (product list)

| Aspect | Behaviour |
|---|---|
| Where | **Server-side**: each page is a separate `GET /products` request |
| Page size | 12 by default; "Rows per page" offers 8, 12, 16, 24, 48 |
| Request | `page`, `per_page`, plus the current tab (`supplier=mapped|zero`), search and filters |
| Server cap | `per_page` is limited to 1–200 (defaults to 24 if not sent) |
| What counts | `total` = rows in the open tab after search + filters. Tab badges = both tabs' totals across the **whole filtered catalogue**, not the visible page |
| Combining | Search + filters are applied first; then the badges are counted; then the tab narrows; then the page is cut |
| Reset | Back to page 1 when search, any filter, the tab, the supplier deep-link or rows-per-page changes; a page beyond the last is pulled back |
| Pager | "Showing 1–12 of 57" (or "No products found") · Rows per page · "1 / 5" · ‹ › buttons (disabled at the ends) |
| Loading | 8 shimmer cards; a newer request cancels an older one |

Other product lists don't use this pager. The supplier picker, master bundle, mapped suppliers and the lead's product directory all load in one go (the directory shows 4 rows per page on the client). See §9 for the limits that apply to dropdowns.

---

## 9. PRODUCT SELECTION IN DROPDOWNS (where & which products appear)

Common server rules for every `/products` call: soft-deleted products never appear. **Employees** see globals + client-level + their own branch. Branch users see globals + client-level + their own branch. Client admins see globals + their client, narrowed by the branch switcher. Results come back newest first. Purchase-dept employees receive no selling price/GST; Sales-dept employees receive no supplier rows.

### 9.1 Sales Matrix → Product Directory (Stage 3, `ProductDirectoryModal.tsx`)
| Condition | Rule |
|---|---|
| Source | `GET /products`, no parameters → **only the 24 newest products** in scope |
| Status | All statuses shown (Draft/Inactive included); option carries a green "Active" / red "Inactive" badge |
| Already added | Products already on the lead are hidden (except the one being edited) |
| Segment | Shown with a violet segment badge; if the customer has segments, other-segment products are **greyed out** with a reason (no-segment products stay enabled) |
| Label | `P-007 · Product name` |
| Server check on save | Product must exist; no duplicates per lead; segment/party and customer-segment guards; one currency per lead |

### 9.2 Quotation / Proforma Invoice item picker (`SalesQPI.tsx`)
| Condition | Rule |
|---|---|
| Source | `/sales/qpi/master-bundle` → products list with `status=active`, `per_page=200` → **200 newest active products** |
| Opportunity picked | Only products on that opportunity: its latest shared-price products, or its Product Directory products if nothing was shared yet. Empty mapping = empty list |
| No opportunity / load error | Full loaded list |
| Already added | Products already on this quotation/PI are hidden |
| Segment | Violet badge (cut at 24 chars); off-segment products greyed: "Customer and product segment must match." |
| Label | `P-007 – Product name` (code padded on screen) |

### 9.3 Purchase Order: legacy wizard (`CreatePoWizard.tsx`, `/p2p/purchase-order`)
| Condition | Rule |
|---|---|
| Source | `GET /products`, no parameters → **24 newest products** (any status); a built-in sample list shows until it loads |
| Already added | A product used on another line is hidden |
| Segment | If the supplier has segments, products without a matching segment name are frozen (toast "Segment not mapped to the supplier") |
| Label | Product name, with padded code + segment badge |

### 9.4 Purchase Order: new form (`create-po`, `/p2p/order`)
| Condition | Rule |
|---|---|
| Source | `GET /products?lite=1&per_page=200` → **200 newest products** (any status) |
| Locked (shown, not pickable) | Not active ("activate it there to order it"); segment not mapped to the supplier unless the product is mapped to that supplier directly; on a PI line, a different segment from the PI line's |
| Label | `P-007 — Product name`; badge = segment, "No segment" or "Inactive" |

### 9.5 Supplier Purchase Invoice (`SpiDetail.tsx`)
| Condition | Rule |
|---|---|
| Source | `GET /products?status=active` → **24 newest active products** |
| Already added | Products on other lines hidden |
| Segment | If the supplier has segments, products whose segment id isn't among them are frozen; products without a segment stay pickable |
| Label | Product name + code + segment |

### 9.6 Supplier master → Map Product (`AddVendorModal.tsx`)
| Condition | Rule |
|---|---|
| Source | `GET /products?per_page=500&lite=1`. The server caps this at 200, so it loads **200 newest products** (any status) |
| Segment required | Products with no segment are dropped |
| Supplier segments | Only products in one of the supplier's segments (all, if it has none) |
| Already added | Products already mapped to the supplier are hidden (except the one being edited) |
| Label | `P-007 — Product name` + violet segment badge |

### 9.7 Bulk Sourcing → Assign Sourcing Target (`AssignSourcingTargetModal.tsx`)
| Condition | Rule |
|---|---|
| Source | `GET /p2p/products` (separate endpoint, **no limit**) |
| Scope | Own client only (no global rows); own branch, or the switcher branch for client-wide users |
| Status | Any status (deleted excluded) |
| Search | Typed text matched against "code name" (case-insensitive, in the browser) |
| Order | Code descending (P-010 above P-002) |
| Already added | Shown ticked with "(added)" and not clickable |
| Label | `P-007 — Product name` |

### 9.8 Other places (not pickers)
- **Stage 3/4/6, Product Sourcing, Price Shared modals** list the lead's own products (`/sales/leads/{id}/products`). They filter by sourcing status, and Stage 4 only asks for prices on Active products.
- **PO from a shipment** loads the PI's lines (`/p2p/purchase-orders/shipments/{id}/pi-products`), not the master.
- **Header search** only navigates to `/products`. **CLM Case-to-Case** hides its Product placeholder tab and loads no products.

---

## 10. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Delete | The delete button is only on the list view, which can't be opened, so products can't be deleted from the UI. The API has no "in use" check |
| Dropdown limits | Several pickers load only the newest 24 or 200 products (§9); older products don't appear |
| Purchase-dept pickers | PO/SPI pickers receive no selling price or GST % for Purchase-dept users |
| Search hint | The box says "code, name, HSN or segment" but searches code, name, brand, generic name and HSN, **not segment** |
| Sort / view | No sort, Segment/Status dropdown or list-view control is shown |
| Owner / rating | Card owner and rating fields have no data |
| Quality step | Weights, dimensions, batch/serial/lot and QC records exist in the data model but are no longer on the form |
| Access | Client admins can't open the Products page |
| Sales dept detail | The detail view shows "Inactive" for every product |

---

*Related documents: PRODUCT_TECHNICAL_DOCUMENTATION.md · PRODUCT_CODE_WALKTHROUGH.md · PRODUCT_API_DOCUMENTATION.md*
