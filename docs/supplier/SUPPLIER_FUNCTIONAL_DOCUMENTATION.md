# SUPPLIER MODULE — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · P2P → Master Management → Supplier Management

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-10-06 | System | Initial functional documentation |
| 1.1 | 2026-10-07 | System | Added dropdown conditions, pagination, supplier card |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
Supplier Management is the master record for every party a tenant **buys from** — identity, registered address, contact persons, KYC/due-diligence evidence, bank accounts, GST scrutiny and the products the supplier sells (with purchase price). It is the source that Product vendor maps, P2P sourcing, Purchase Orders, Supplier Invoices, Zoho Books and the CLM Supplier Profile all read. In code the module is called **Vendor**; the screen is at `/suppliers` (the old `/vendors` path redirects there).

### 1.2 Business value
| Benefit | Description |
|---|---|
| One supplier book | A branch-shared catalogue every buyer in the branch can use and maintain |
| Domestic vs International | GST/IFSC rules for Indian suppliers; TIN/SWIFT/IBAN rules for overseas ones |
| Compliance at a glance | "Compliant / Non Compliant" derived live from the supplier's segment documents and signed agreements |
| Procurement readiness | Products mapped with purchase price + GST, mirrored onto the product's supplier list |
| Commercial standing | Supplier Category: Star / General / High Risk / Blacklisted |
| Evidence | Uploads for DD, Owner KYC, Trade Licences, cancelled cheques, business cards; Evidence Vault per supplier |

### 1.3 Key features
- **Supplier list** with Domestic / International tabs, search across every visible column, Refine panel (category + compliance with counts), server-side paging.
- **Scope gate** — "Domestic or International?" asked before the Add form opens (not asked on edit).
- **3-step wizard** — Identity & Address → KYC → Map Products; each step saves on its own.
- **Independent rows** — extra contacts, bank accounts and GST scrutiny rows save the moment they are added.
- **Mapped Products popup** and **Evidence Vault** from each row.
- **Segment protection** — a segment cannot be dropped while products / POs / Supplier Invoices depend on it.

---

## 2. ROLES & ACCESS

The menu leaf is **`p2p.supplier`** ("Supplier Management"), but the route guard treats `/suppliers` as a default module for every tenant business user, and the page itself only opens for **branch users and employees**.

| Role | Access |
|---|---|
| Super Admin | API sees all suppliers; the list page shows "Branch / Employee only" |
| Client Admin / Client User | API scoped to client (+ branch switcher); the list page shows "Branch / Employee only" |
| Branch User | Own branch + client-level + global suppliers; full add / edit |
| Employee | Same branch-wide book as the branch user (not just own rows); full add / edit |

Edit/delete are **not** creator-locked: anyone who can see a supplier can change it (`hierarchicalDenial` exempts Vendor). No server-side permission flag is checked.

---

## 3. BUSINESS PROCESS FLOW

```
┌───────────────────────────────────────────────────────────────────┐
│                       SUPPLIER LIFECYCLE                            │
└───────────────────────────────────────────────────────────────────┘
   ADD SUPPLIER → choose Domestic / International
        │
        ▼
   STEP 1  Identity & Address            status = draft · step 1
        │  → code S-### allocated (per branch)
        │  → primary contact, extra contacts (saved per row)
        ▼
   STEP 2  KYC                            status = inactive · step 2
        │  Company DD · Owner KYC · Trade Licence (saved together)
        │  Bank Details · GST Scrutiny        (saved per row)
        ▼
   STEP 3  Map Products                   status = active · step 4
        │  product + purchase price + GST → mirrored to product side
        ▼
   IN USE  P2P sourcing · Purchase Orders (currency locked once in Zoho)
           Supplier Invoices · CLM Supplier Profile · Evidence Vault
        │
        ▼
   DELETE  soft delete + files removed (API only — no list button)
```

### 3.1 Step 1 — Identity & Address
| Tab | Captures |
|---|---|
| Identification | Company name*, legal name*, website, Supplier Type (Material / Goods · Services · FFD / Transporter), Segment(s), Risk Level, Supplier Behaviour (Genuine · Cooperative & Responsive · Non Responsive & Inconsistent · Fraud Alert), Supplier Category, Classification, GST Applicable + GST Number (domestic) or TIN (international) |
| Address & Contacts | Registered office address, country, state, state code, city, pincode, Google Maps link; primary contact person* (+ business card); additional contact persons |

### 3.2 Step 2 — KYC
| Sub-tab | Captures | Saved |
|---|---|---|
| Company Due Diligence | Document name, authority, expiry, mandatory flag, file | With "Save" (replace-all) |
| Owner KYC | Document name, number, authority, issue date, expiry, status, file | With "Save" (replace-all) |
| Trade Licence | Licence type, number, authority, issue/expiry date, file | With "Save" (replace-all) |
| Bank Details | Bank, branch, account no., IFSC / SWIFT, branch address, cancelled cheque | Per row |
| GST Scrutiny (GST Applicable = Yes only) | GSTIN, status, last filing date, prior non-GST 2A invoice, red flags | Per row |

### 3.3 Step 3 — Map Products
Pick products, enter batch/serial/lot, purchase price*, GST % / amount, total. Saving at least one mapping makes the supplier **Active** and also activates the mapped products.

---

## 4. SCREEN SPECIFICATIONS

### 4.1 Supplier list (`Vendors.tsx`)
```
┌───────────────────────────────────────────────────────────────────┐
│  Supplier Management                              [+ Add Supplier] │
├───────────────────────────────────────────────────────────────────┤
│  [Domestic Supplier | International Supplier]  [Search] [Refine ▼] │
│  Sr│Code│Name│Type│Segment│Country│State│GST State Code│Contact│   │
│  Contact No│Email│Category│Compliant Status│Mapped Products│Actions│
│  Actions: Edit Supplier · Evidence Vault · (Mapped Products badge) │
│  Pager: 10 / 25 / 50                                               │
└───────────────────────────────────────────────────────────────────┘
```

### 4.2 Add / Edit wizard (`AddVendorModal.tsx`)
Three steps with sub-tabs as in §3. Opened directly on edit via `/suppliers?edit=<id>` (used by Bulk Sourcing → Mapped Suppliers, which returns there after save).

### 4.3 Evidence Vault (`SupplierEvidenceVaultModal.tsx`)
Read-mostly view of the supplier's segment documents, agreements (with signature reminders) and PO documents; supports uploading against segment rules.

---

## 5. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | Supplier code is `S-###`, numbered separately per client **and branch**; a deleted supplier's code is never reused |
| 2 | Company name and legal name are mandatory; primary contact name is mandatory |
| 3 | Indian supplier → GST Applicable must be **Yes** |
| 4 | International supplier → TIN mandatory, 3–30 chars (letters, digits, `- / .` and space), stored uppercase |
| 5 | A GST number may belong to only one supplier in the tenant |
| 6 | Primary contact email is unique across **all** suppliers system-wide (and P2P suppliers) |
| 7 | Bank: domestic IFSC `AAAA0XXXXXX` + 9–18 digit account; international SWIFT 8/11 + 8–34 alphanumeric account; no duplicate account per supplier |
| 8 | All GST scrutiny rows of a supplier always carry the same GSTIN |
| 9 | Uploads: JPG / PNG / WEBP / PDF, max 2 MB each |
| 10 | A product can be mapped only once per supplier |
| 11 | A segment can't be removed if a mapped product, PO or Supplier Invoice uses it |
| 12 | Supplier **State** is locked once any Purchase Order exists for the supplier |
| 13 | A supplier trades in one currency once a PO in that currency has reached Zoho Books |

---

## 6. STATUS MODEL

| Status | Meaning | Set by |
|---|---|---|
| draft | Identity saved only | Step 1 create |
| inactive | KYC saved, no products yet | Step 2 save |
| active | At least one product mapped | Step 3 save |

`step_completed` records progress: 1 (identity/contacts), 2 (KYC), 4 (products). Compliance (Compliant / Non Compliant) is computed, not stored.

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Access | Client admins can't open the list page; no per-user add/edit/delete permission is enforced |
| Recurring tab | Parked — every supplier counts as "Fresh" until case-to-case procurement ships |
| Delete | No delete or restore button in the UI |
| Segment removal | If a removed segment has its own documents, the UI asks you to delete them first (no in-place confirm) |
| GST scrutiny | Rows can be added but not edited or deleted from the UI |
| GSTIN prefix | The "GSTIN must start with the state code" rule is not currently enforced |

---

## 8. SUPPLIER SELECTION IN DROPDOWNS (where & which suppliers appear)

**Common to every picker below (unless the table says otherwise):**
- You only see suppliers your login can see: **employees and branch users** → suppliers of their own branch + suppliers with no branch (client-level). **Client admins** → the whole client, narrowed to the branch picked in the branch switcher when one is picked. Other branches never appear.
- **Deleted** suppliers never appear.
- **Draft, Inactive and Active suppliers all appear** — no picker filters on status or on how far the wizard was completed.
- Typing in a dropdown filters the already-loaded list by the visible text (case-insensitive, "contains"). The list draws 10 options at a time and adds more as you scroll.

### 8.1 Product → Map Supplier (Add/Edit Product wizard, Vendors step)
| Question | Answer |
|---|---|
| Screen | Products → Add/Edit Product → Map Supplier popup (`AddProductModal.tsx`) |
| List source | Product master bundle (refreshed after "+ Add Supplier") |
| Who appears | All suppliers you can see, newest first |
| Hidden | Suppliers already mapped to this product (except the row being edited) |
| Segment | Not filtered. On **Add**, a supplier whose segments don't include the product's segment is refused ("Segment mismatch"); a supplier with no segment is allowed |
| Status | Not filtered (draft/inactive shown) |
| Shown as | `S-004: Company Name` + first segment badge (+N for more). Supplier Code and Supplier Type auto-fill below |

### 8.2 P2P Bulk Sourcing → Map Supplier Directory → Supplier Master
| Question | Answer |
|---|---|
| Screen | P2P → Bulk Sourcing → Map Supplier (`MapSupplierModal.tsx`) |
| Who appears | All suppliers you can see, A→Z by company name |
| Hidden | Nothing up front. Mapping a supplier that's already on the product fails on save ("already mapped to this product") |
| Shown as | `S-004 — Company` + green **Domestic** / violet **International** badge (from the primary address country; none if no country). After picking: initials avatar, code, segment, contact, mobile, email |

### 8.3 P2P Bulk Sourcing → Mapped Suppliers popup
Read-only list of the suppliers already mapped to one sourcing product (newest first), each tagged **Master** or **New Supplier**. Not a picker.

### 8.4 Purchase Order → Select Supplier
| Question | `/p2p/order` (Create PO, Stage 1) | `/p2p/purchase-order` (Create PO wizard) |
|---|---|---|
| File | `Step1LinkSupplier.tsx` | `CreatePoWizard.tsx` |
| Order | A→Z by company name | Highest code first (S-019, S-018 …) |
| Hidden | — | Suppliers with no code |
| Disabled (shown greyed, with reason) | **Blacklisted** category; Supplier Type ≠ the PO Type (only Material / Goods POs can be raised today). The supplier already on the PO stays pickable | — |
| Shown as | `S-004 — Company`, badge Domestic / International (or red Blacklisted), grey supplier-type tag | `S-004: Company`, DOM / INT badge |
| Side effects | Picking a supplier sets the PO Document Type to match. If the supplier's currency is already settled in Zoho Books, the **currency** dropdown locks to that currency (the supplier list itself is not filtered by currency) | Same document-type rule |

### 8.5 Supplier Purchase Invoice (without PO) → Select Supplier
| Question | Answer |
|---|---|
| Screen | P2P → Supplier Purchase Invoice → Map SPI → "Without PO" (`MapSupplierPurchaseInvoiceModal.tsx`) |
| Order | Highest code first |
| Shown as | `S-004 — Company` (or just the name when no code) + domestic/international marker |
| Hidden | Nothing |

### 8.6 CLM → Case-to-Case agreement → Add Counterparty → Supplier tab
| Question | Answer |
|---|---|
| Screen | CLM → Case to Case form (`ClmCtcForm.tsx`) |
| Who appears | All suppliers you can see, A→Z |
| Search | Name, code and email |
| Hidden | Once the first counterparty is added, only suppliers of the **same category** (India = Domestic, other = International) remain. The Supplier tab is disabled once a supplier is added (one per agreement) |
| Shown as | Name, code, country, contact number, email |

### 8.7 Sales Matrix → Stage 3 Product Sourcing / Product Sourcing popup → Vendor Count
Clicking the count opens the suppliers mapped to that product (name, code, purchase price, total). **Sales-department users get an empty list**, so for them the count shows but the popup never opens. The count includes every mapping row on the product, even for a supplier that was later deleted.

### 8.8 Other places
| Place | Behaviour |
|---|---|
| Payment Request → Supplier → Evidence Vault | Not a dropdown — finds the supplier by **company name** in the supplier list to open its vault |
| CLM → Supplier Profile | A list (not a picker) of all visible suppliers, bucketed by Supplier Type and shipment; uses only the supplier's **first** segment |
| Masters → Assets → "Supplier" | Reads the separate **Supplier Directory** master, not Supplier Management. If that master returns no rows, two built-in sample names are shown |
| Products list `?vendor_id=` | URL filter only; no dropdown |

---

## 9. PAGINATION

| Item | Behaviour |
|---|---|
| Where | **Server-side** — each page is a separate request |
| Page size | Starts at 10 (or the last size that fitted this screen). It then grows to fill the window height, **never below 10**, and re-fits on window resize. The **Rows per page** picker (10 / 25 / 50) overrides the fit for the rest of the visit |
| Order | Newest supplier first |
| Search | Waits 0.5 s after you stop typing (clearing is instant). It matches name, legal name, code, email, GST/TIN, category, any contact's name / number / email, city, state code, state, country, supplier type and segment |
| Combining | Search, Domestic/International tab and Refine filters are all applied on the server **before** paging |
| Refine counts | Counted across **all** matching suppliers (after search + tab, before the Refine ticks), not just the current page |
| Back to page 1 | When the tab, search, Refine selection or a manually picked page size changes |
| Pager | Violet band: "Showing 11–20 of 41" · Rows per page · "2 / 5" pill · ‹ › buttons (disabled at the ends). "No records" when empty |
| Other lists | Every supplier dropdown loads its full list at once (no paging). The Mapped Products popup (supplier wizard) and the supplier-mapping grid in the Product wizard load everything, then page in the browser at 3 rows per page |

---

## 10. SUPPLIER CARD (list row)

The supplier list is a table — each supplier is one row. There is no supplier logo or avatar. The page header has a fixed icon, and the Map Supplier picker shows two-letter initials.

```
┌────┬───────┬──────────────┬──────────────┬──────────────┬───────┬────────────┬─────┬──────────────┬──────────┬──────────────┬──────────────────┬─────────────┬────────┬──────────────────┐
│ Sr │ Code  │ Supplier Name│ Supplier Type│ Segment      │Country│ State      │ GST │ Contact      │Contact No│ Email        │ Supplier Category│ Compliant   │ Mapped │ Actions          │
│    │       │              │              │              │       │            │Code*│ Person       │          │              │                  │ Status      │Products│                  │
├────┼───────┼──────────────┼──────────────┼──────────────┼───────┼────────────┼─────┼──────────────┼──────────┼──────────────┼──────────────────┼─────────────┼────────┼──────────────────┤
│ 11 │ S-004 │ Acme Foods…  │ ● Material   │ Rice [High]+2│ India │ Maharashtra│ 27  │ R. Joshi  +1 │ 98765…   │ r@acme.in    │ ★ Star Supplier  │ ✓ Compliant │  [3]   │ ✎ │ Evidence Vault│
└────┴───────┴──────────────┴──────────────┴──────────────┴───────┴────────────┴─────┴──────────────┴──────────┴──────────────┴──────────────────┴─────────────┴────────┴──────────────────┘
 * GST State Code column only on the Domestic tab
```

| Field | Source | Format / fallback |
|---|---|---|
| Sr No | Position on the page | Continues across pages |
| Supplier Code | `vendor_code` | Fallback `S-` + id padded to 3 |
| Supplier Name | `company_name` | Truncated with tooltip; fallback "Untitled Supplier" |
| Supplier Type | Supplier Type master name | Pill: **teal** for logistics/transport/FFD/freight, **amber** for services, **purple** otherwise; "Pending" when not set |
| Segment | Segment pivot (falls back to the single segment) | First segment + High/Low regulatory badge; `+N` opens the full list; "—" when none |
| Country | Primary address country | "—" when not set |
| State | Primary address state name | Falls back to state code, then "—" |
| GST State Code | Primary address state code | Domestic tab only; "—" when empty |
| Contact Person | First named contact (primary first) | "—"; `+N` opens all contacts (contacts with no name are skipped) |
| Contact No | Primary contact number | "—" |
| Email | Primary contact email, else supplier primary email | "—" (still rendered as a mailto link) |
| Supplier Category | `supplier_category` | ★ Star (star icon) · General (medal) · ⚠ High Risk · ⊘ Blacklisted; "—" if unset (cannot happen in practice — the column defaults to General) |
| Compliant Status | Calculated on the server | Green ✓ Compliant / red Non Compliant. A supplier with no document rules counts as Compliant. Never blank in practice (the dash tooltip still mentions the old "compliance behaviour") |
| Mapped Products | Number of mapped products | Clickable badge opens the read-only Mapped Products popup; 0 is a flat, non-clickable badge |
| Actions | — | **Edit Supplier** (always) · **Evidence Vault** (always). The Zoho Entry button is commented out |

Loaded but **not shown** on the row: Status (draft/inactive/active) and legal name. Risk level and city are passed only to the Evidence Vault. There is no Status column or status badge, so a Draft supplier looks the same as an Active one.

**Edit wizard header:** "Edit Supplier — S-004" (or "Add Supplier"), plus a **Map Product** button that stays disabled until Step 1 is saved. A recap of earlier stages lists Company Name, Legal Name, Supplier Type, Segment, Risk Level, Supplier Behaviour, Supplier Category and GST Number / TIN ("—" when empty).

---

*Related documents: SUPPLIER_TECHNICAL_DOCUMENTATION.md · SUPPLIER_CODE_WALKTHROUGH.md · SUPPLIER_API_DOCUMENTATION.md*
