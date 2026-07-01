# CUSTOMER MODULE — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Sales Matrix → Customer (buyer entity)

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
The **Customer** module is the buyer master of the **Sales Matrix**. A *Customer* is a company (buyer entity) that a tenant sells to; each customer can carry multiple contacts/locations, KYC & due-diligence documents, owner records, GST-compliance scrutiny, and one or more **Consignees** (recipient companies). It is the entry point of the sales lifecycle — a customer becomes the counterparty on **leads → quotations → proforma invoices → shipments**.

Creating/maintaining a customer is a **two-stage** process:
- **Stage 1 — Customer Legal Identity:** company/legal details, segment(s), GST-applicable flag, primary address & contact, and any additional locations.
- **Stage 2 — KYC / Due Diligence:** company due-diligence documents, owner KYC, and trade licences — driven by the segment's document rules (DCP).

### 1.2 Business Value

| Benefit | Description |
|---|---|
| Single buyer master | One record holds identity, contacts, locations, KYC, owners, GST history |
| Segment-driven compliance | Selecting a business segment surfaces the mandatory/optional documents that must be collected |
| GST scrutiny | Per-GSTIN compliance tracking (filing status, red flags); one GSTIN is bound to one customer |
| Consignee re-use | "Same as Customer" consignees are kept in lock-step via the KYC mirror service |
| Multi-tenant isolation | Every customer is scoped to `client_id` / `branch_id`; branch users see only their own |
| Recoverability | Soft-deletes — customers and GST rows can be restored |
| Evidence trail | An Evidence Vault consolidates every document/agreement/signature for audit |

### 1.3 Key Features
- **Customer list** with Fresh/Recurring tabs, debounced search, per-type pills, segment "+N" popover, consignee count and row actions.
- **Add / Edit customer** — a 2-stage wizard (Legal Identity → KYC/Due Diligence) with sub-tabs, inline validation and auto-save between stages.
- **Segment multi-select** that drives the required-document reference tables in Stage 2.
- **GST Scrutiny** — header button (domestic customers) → manage popup (list) + add-form popup; GSTIN format validation and cross-customer uniqueness.
- **KYC / Due Diligence** — company DD documents, owner KYC (with 3 identity proofs), and trade licences, each with a segment-rule reference table and a live-data table.
- **Consignee mapping** — attach recipient companies; "Same as Customer" consignees auto-mirror the customer's KYC.
- **Customer Evidence Vault** — a 5-tab consolidated view (Company DD, Owner KYC, Trade Licences, Trade Documents, Shipment Agreements) with export.
- **Auto-provisioned customer code** — `C-0001`, `C-0002`… allocated per client under a row lock.

---

## 2. USER ROLES & PERMISSIONS

### 2.1 Who uses this module
| Role | Access |
|---|---|
| **Super Admin** | Full — sees all customers platform-wide (NULL-client bucket + all tenants) |
| **Client Admin / Client User** | Their own tenant's customers; client-admin can narrow to a branch via the Branch Switcher |
| **Branch User** | Client-level customers + their own branch's rows |
| **Employee** | Creator-scoped visibility (see own; hierarchy rules via `MasterVisibility`) |

Visibility is enforced **server-side** on every query via the `Customer::forUser($user)` scope (`MasterVisibility::applyReadScope`), unlike the Client module which is menu-gated only.

### 2.2 Capability Matrix (driven by the `sales.customers` permission)
| Feature | View | Add | Edit | Delete |
|---|---|---|---|---|
| See customer list | `can_view` | — | — | — |
| Create customer | — | `can_add` | — | — |
| Edit customer / KYC / GST | — | — | `can_edit` | — |
| Map / add consignee | `can_view` | `can_add` | — | — |
| Delete customer | — | — | — | `can_delete` |

> Super-admins bypass permission checks. Buttons in `SalesCustomers.tsx` are gated by `can_add` / `can_edit`.

---

## 3. BUSINESS PROCESS FLOW

### 3.1 Customer lifecycle

```
┌───────────────────────────────────────────────────────────────────┐
│                       CUSTOMER LIFECYCLE                            │
└───────────────────────────────────────────────────────────────────┘
                              START
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STEP 1: OPEN "ADD CUSTOMER"                                       │
│  • Sales → Customers → Add Customer                              │
│  • Modal loads dropdowns from /customers/master-bundle           │
│    (types, segments, classifications, risk, address types,       │
│     countries, states, designations, document types; cached 5m)  │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STAGE 1: CUSTOMER LEGAL IDENTITY                                 │
│  Identification tab:  company + legal name + type + website,      │
│     Customer Segment (multi), GST Applicable (Yes/No),           │
│     Classification, Risk Level                                   │
│  Address & Contact tab: primary address + contact person,        │
│     + additional locations (unique email/phone per customer)     │
│  → Save & Next  (POST /customers on first save; PUT thereafter)  │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  (optional) GST SCRUTINY  — domestic customers (GST Applicable=Yes)│
│  • Header button → manage popup (list, 5/page) + add-form popup   │
│  • GSTIN validated; a GSTIN is unique across customers           │
│  • Once ≥1 entry exists, GST Applicable is locked to Yes          │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STAGE 2: KYC / DUE DILIGENCE                                     │
│  Sub-tabs: Company DD · Owner KYC · Trade Licence                │
│  • Segment rules surface required/optional docs (reference table)│
│  • Upload docs → POST /customers/{id}/documents (kind=dd|tl)      │
│  • Add owners → POST /customers/{id}/owners (+ 3 identity proofs) │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STEP 4: MAP CONSIGNEES / EVIDENCE VAULT                          │
│  • Map Consignee → recipient companies (Same-as-Customer mirrors) │
│  • Evidence Vault → 5-tab consolidated document/signature view    │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STEP 5: USE IN SALES MATRIX                                      │
│  • Customer becomes counterparty on Leads → Quotations → PI →     │
│    Procurement → Shipment                                         │
│  • "Recurring" once it has ≥1 lead; "Fresh" until then           │
└───────────────────────────────────────────────────────────────────┘
```

### 3.2 What happens on create (detail)
| Action | Detail |
|---|---|
| Customer code | `C-` + 4-digit sequence, **per client**, allocated under a `clients` row lock; `withTrashed()` so numbers never reuse |
| Primary address | Exactly one address row with `is_primary = true`; its `cp_email` mirrors to `customers.primary_email` |
| Additional locations | Extra address rows (`is_primary = false`); emails/phones must be unique within the customer |
| Segment | Multi-select stored comma-separated (`varchar(1024)`) |
| GST Applicable | `Yes` / `No`; gates the GST Scrutiny popup |
| Transaction | Customer + all addresses created atomically (`DB::transaction`) |

### 3.3 What happens on edit
| Action | Effect |
|---|---|
| Address list | **Replace-all** — existing addresses deleted and recreated from the payload |
| Segment removal guard | Blocked (422) if documents were already uploaded for that segment (`SegmentGuard`) |
| Consignee sync | Core fields + address book synced to "Same as Customer" consignees (`ConsigneeKycMirror::syncCoreFromCustomer`) |
| KYC change | Adding/editing/deleting a document or owner re-mirrors KYC files to same-as-customer consignees (`resyncForCustomer`) |

---

## 4. SCREEN SPECIFICATIONS

### 4.1 Screen: Customers (list) — `SalesCustomers.tsx`
```
┌───────────────────────────────────────────────────────────────────┐
│  Customers                                          [+ Add Customer]│
│  (color strip · "What we are doing here" 4-step collapsible)       │
├───────────────────────────────────────────────────────────────────┤
│  [ Fresh Customers ]  [ Recurring Customers ]                      │
│  [Search name / ID / company / email / segment…]                  │
│  ┌───────────────────────────────────────────────────────────────┐│
│  │Sr│Cust ID│Company│Type│Segment│Country│Contact│Phone│Email│WA│#│⋯││
│  │1 │C-001  │Acme ● │Retl│Dairy+2│India  │J.Doe  │+91… │j@…  │Y │2│⋯││
│  └───────────────────────────────────────────────────────────────┘│
│  Row actions: Edit · Map Consignee · Customer Evidence Vault       │
└───────────────────────────────────────────────────────────────────┘
```
- **Tabs:** *Fresh* (no leads yet) / *Recurring* (has ≥1 lead). Search is debounced 300 ms and matches name/ID/company/email/segment.
- **Columns:** Sr No, Customer ID (mono chip), Company (truncated + tooltip), Customer Type (colored pill), Segment (first + "+N" popover), Country, Contact Person, Contact No, Email, WhatsApp (Yes/No), Consignees (count), Actions.
- **Pagination:** 10 rows/page (auto-scales to viewport).
- **Row actions:** Edit (warns if consignees exist), Map Consignee (needs a saved customer), Customer Evidence Vault.

### 4.2 Screen: Add / Edit Customer — `AddCustomerModal.tsx` (2 stages)

| Stage | Sub-tab | Fields |
|---|---|---|
| **1. Customer Legal Identity** | **Identification** | Company Name*, Company Legal Name, Customer Type*, Website · Customer Segment* (multi), **GST Applicable*** (Yes/No), Classification, Risk Level |
| | **Address & Contact** | Address Type (locked "Registered Office"), Address*, Country*, State*, City*, Pin (6-digit)*, Contact Person Name*, Designation, Phone*, Email*, WhatsApp · **Additional Locations** table (add/edit/delete) |
| **2. KYC / Due Diligence** | **Company DD** | Segment-rule reference table (mandatory/optional) → live docs: Name, License #, Issuing Authority, Issue/Expiry dates, Attachment |
| | **Owner KYC** | Owner Name, Designation, Email, Phone + ID Proof / Address Proof / Photograph uploads |
| | **Trade Licence** | Segment-rule trade-licence docs (kind `tl`), same 9-column layout as DD |

Validation highlights: company name 2–30, legal name 2–100, address 4–75, Pin exactly 6 digits, phone 7–15 (international), valid email, GST Applicable required. Inline errors + scroll-to-first-error. **Auto-save**: Stage 1 is persisted (POST then PUT) when advancing to Stage 2 so KYC can be uploaded before final submit.

### 4.3 Feature: GST Scrutiny (domestic customers)
- **Header button** — enabled only when GST Applicable = *Yes*; shows a count badge; disabled/greyed otherwise.
- **Manage popup** — list table (Sr No, GST Number, Status *Active/Inactive*, Last Filing Date, Prev Non-GST 2A Invoice, Red Flags); 5 rows/page, newest first; a **+ Add GST Scrutiny** button.
- **Add-form popup** (stacked above the list) — GST Number (15-char), GST Status, GST Last Filing Date*, Previous Non-GST 2A Invoice, Red Flags.
- **Rules:** GSTIN progressive-format validation; a GSTIN belongs to **one customer only** (cross-customer duplicate → *"already registered to another customer"*); once any entry exists the **GST Applicable flag is locked to Yes**.

### 4.4 Feature: Customer Evidence Vault
A separate, **read-only compliance archive** modal (`CustomerEvidenceVaultModal.tsx`, from the list row action). It answers *"for this customer, which required documents exist, are they attached, and are the trade documents signed?"* Data comes from one call — **`GET /segment-uploads/customer/{id}/vault`** — composed on the server from three sources: the **segment rules** (which docs the chosen segment(s) require), the **uploaded files** (`segment_doc_uploads`), and the **Zoho signature requests** (`clm_signature_requests`).

**5 tabs** (two groups):
| Group | Tab | Shows |
|---|---|---|
| Standard (one-time) | **Company Due Diligence** | Segment-required DD docs (Sr No, Auto Code `DD-###`, name, issuing authority, requirement M/O, attachment, actions) |
| | **Owner KYC Details** | Segment-required KYC docs (auto-code `KYC-###`) |
| | **Trade Licenses** | Segment-required trade licences (auto-code `TL-###`) |
| Case-to-case (per-deal) | **Trade Documents** | Segment trade docs **merged with live Zoho signing status** (Draft/Pending/Signed/Declined/Recalled) |
| | **Agreements / Shipments** | A per-shipment matrix (one row per shipment/opportunity) with coverage ratios per category + a risk badge; expands to Buyer/Consignee sub-tables |

**Header KPIs:** Total Documents · Verified/Signed (✓ Compliant) · Pending (⚠ Action) · per-bucket counts · Total Shipments.

**Row actions:** View · Download · **Re-Upload** (standard tabs, re-posts to `/segment-uploads/customer/{id}` by `doc_code`) · **Send for signature** / **Remind** / **Signing tracker** / **Certificate of Completion** (Trade Documents/shipment rows, via Zoho).

**Export All:** a multi-sheet **XLSX** (`EvidenceVault_{customerId}_{date}.xlsx`) — a Summary sheet + one sheet each for DD, KYC, Trade Licenses, Trade Documents, Shipment Agreements.

**Status badges:** `Verified` (green ✓) · `Signed` (blue ✓) · `Expiring` (amber ⚠) · `Pending` (red ⌛).

> **Verification is display-only.** There is **no** approval/verify workflow, `verified_by`, or `verified_at`. A document shows **"Verified" simply because a file was uploaded** for that segment-rule code; otherwise it's **"Pending"**. "Signed" comes from a completed Zoho request.

> **Same-as-Customer consignees:** opening the vault for a consignee flagged `same_as_customer` transparently returns the **parent customer's** documents (the payload carries `same_as_customer: true`); uploads to such consignees are blocked.

### 4.5 Feature: Consignee mapping
"Map Consignee" opens `CustomerConsigneesModal` — lists the customer's consignees and adds new ones (`AddConsigneeModal` pre-filled with the customer). "Same as Customer" consignees are auto-mirrored.

### 4.6 Two document stores (important)
The Customer module keeps documents in **two independent stores** — don't confuse them:

| Store | What it is | Entered via | Endpoint | Appears in Evidence Vault? |
|---|---|---|---|---|
| **Segment uploads** (`segment_doc_uploads`) | The **segment-rule-driven** compliance docs, one per auto-code (`DD-###`/`KYC-###`/`TL-###`/`TD-###`), polymorphic across customer/consignee/vendor | Stage-2 **reference-table** rows (Upload / Re-Upload) | `POST /segment-uploads/customer/{id}` | **Yes** — this is what the vault reads |
| **Ad-hoc KYC** (`customer_documents` `kind=dd/tl`, `customer_owners`) | Free-form documents & owner records added by hand | Stage-2 **"Add Document / License"** and **"Add Owner"** sub-modals | `POST /customers/{id}/documents`, `/owners` | No (these back the edit form + the consignee mirror) |

Both live under Stage 2. The **reference tables** (mandatory/optional per segment) drive the segment-upload store and the vault; the **sub-modals** feed the ad-hoc store and are what the `ConsigneeKycMirror` clones to same-as-customer consignees.

---

## 5. BUSINESS RULES

| # | Rule | Behaviour |
|---|---|---|
| 1 | Customer code | Auto `C-####`, unique **per client**, allocated under a `clients` row lock; never reuses a soft-deleted code |
| 2 | Legal name | Unique per tenant, case-insensitive (skipped if blank) |
| 3 | Primary email | Unique per tenant; mirrored from the primary address's `cp_email` onto `customers.primary_email` |
| 4 | Primary contact phone | Unique per tenant (primary address only) |
| 5 | Within-customer uniqueness | No email/phone may repeat across a customer's primary + location addresses |
| 6 | GSTIN uniqueness | A GSTIN is bound to **one customer**; the same customer may repeat it across scrutiny entries |
| 7 | GST Applicable lock | Once any GST-scrutiny entry exists, the flag can't be changed away from *Yes* |
| 8 | Pin code | Exactly 6 digits (Indian format) |
| 9 | Segment removal guard | Can't remove a segment once documents were uploaded for it (422) |
| 10 | Address strategy | Edit replaces the whole address set (delete-all + recreate) |
| 11 | Consignee mirror | "Same as Customer" consignees keep core fields + addresses + KYC in sync with the customer |
| 12 | Tenant scoping | Every query scoped by `client_id` / `branch_id` derived from the authenticated user |
| 13 | Soft deletes | Customers and GST rows are soft-deleted (recoverable); GST rows are force-deleted on explicit delete |

---

## 6. STATUS MODELS

### 6.1 Customer status
| Status | Meaning |
|---|---|
| Active | Default; usable across the Sales Matrix |
| Inactive | Retained but flagged inactive |

### 6.2 Fresh vs Recurring (derived, not stored)
- **Recurring** — the customer has ≥1 non-deleted lead.
- **Fresh** — no leads yet.

### 6.3 GST scrutiny status
`Active` / `Inactive` (UI); the compliance state of a specific GSTIN row.

### 6.4 Document / Owner status
`Active` / `Inactive` per row.

---

## 7. KNOWN LIMITATIONS (customer-facing)

| Area | Limitation |
|---|---|
| Address edits | Editing a customer deletes and recreates all address rows (IDs are not preserved) |
| Segment storage | Segments are stored as a comma-separated string, not a join table |
| Evidence Vault | The Trade Documents / Shipment tabs depend on Zoho Sign; status can lag the webhook (polled every 15 s) |
| GST Applicable | Cannot be switched back to *No* once a scrutiny entry exists (must delete entries first) |
| Trade docs | Require CLM segment rules + trade-doc library to be configured for the party type (buyer) |
| Verification | Evidence-Vault "Verified" is **display-only** — it just means a file was uploaded; there is no reviewer approval step, `verified_by`, or `verified_at` |
| Two doc stores | Segment uploads (vault) and ad-hoc `customer_documents`/`customer_owners` are separate; ad-hoc documents do not appear in the vault |
| Shipment tab | The Agreements/Shipments matrix is empty for a customer with no lead + shipment order |

---

*Related documents: CUSTOMER_TECHNICAL_DOCUMENTATION.md · CUSTOMER_CODE_WALKTHROUGH.md · CUSTOMER_API_DOCUMENTATION.md*
