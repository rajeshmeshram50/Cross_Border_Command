# CONSIGNEE MODULE — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Sales Matrix → Consignee (ship-to entity, belongs to a Customer)

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
A **Consignee** is a **recipient company** (the "ship-to" party) that belongs to a **Customer** (the buyer). Where a customer *places* the order, a consignee *receives* the goods — a single customer can have several consignees (e.g. different delivery entities / countries). Structurally a Consignee is a **mirror of the Customer entity**: same identity/address/KYC shape, **plus** a `customer_id` link, its own `consignee_code` (`CN-####`), and a **`same_as_customer`** flag.

The module supports two ways to bring a consignee in:
- **Standalone** — from `/sales/consignee`, pick the parent customer, then fill the 2-stage form.
- **From the customer** — the "Map Consignee" action on the customer list opens the same form with the parent customer **pre-selected and locked**.

### 1.2 Business Value

| Benefit | Description |
|---|---|
| Ship-to modelling | Separates who *buys* (Customer) from who *receives* (Consignee) for cross-border shipments |
| One-click cloning | "Same as Customer" copies the customer's identity, addresses and KYC into the consignee automatically |
| Segment-driven compliance | Selecting business segment(s) surfaces the required KYC/DD/Trade-Licence documents (same DCP engine as Customer) |
| Evidence trail | A consignee Evidence Vault consolidates every document + trade-doc signature for audit |
| Multi-tenant isolation | Every consignee is scoped to `client_id` / `branch_id`; branch users see only their own |
| Recoverability | Soft-deletes — consignees can be restored |

### 1.3 Key Features
- **Consignee list** with the parent **Customer ID**, **Same as Customer** flag, risk pill, segment "+N" popover and row actions (Edit · Evidence Vault).
- **Add / Edit consignee** — a **customer-picker** phase, then a 2-stage wizard (**Consignee Legal Identity → KYC / Due Diligence**) that mirrors the customer form.
- **Same as Customer** — a toggle that copies the parent customer's Stage-1 fields + address book, and on Stage-1→2 clones its KYC (documents + owners) into the consignee (`clone-from-customer`). **Only one** mirror consignee is allowed per customer.
- **Segment-driven KYC** — Company Due Diligence, Owner KYC and Trade Licences, driven by the segment rules (identical to Customer Stage 2).
- **Consignee Evidence Vault** — the same 5-tab consolidated view; for a `same_as_customer` consignee it shows the **parent customer's** documents.
- **Auto-provisioned code** — `CN-0001`, `CN-0002`… allocated per client.

> **Differences from Customer:** a Consignee has **no Customer Type** field, has **no GST Scrutiny** feature, and adds a **parent-customer link** + **Same-as-Customer** mirror.

---

## 2. USER ROLES & PERMISSIONS

### 2.1 Who uses this module
| Role | Access |
|---|---|
| **Super Admin** | Full — all consignees platform-wide |
| **Client Admin / Client User** | Their tenant's consignees; branch narrowing via the Branch Switcher |
| **Branch User** | Client-level + own-branch consignees |
| **Employee** | Creator-scoped visibility (`MasterVisibility`) |

Visibility is enforced **server-side** on every query via `Consignee::forUser($user)`.

### 2.2 Capability Matrix (driven by the `sales.consignee` permission)
| Feature | View | Add | Edit |
|---|---|---|---|
| See consignee list | `can_view` | — | — |
| Create consignee (+ pick customer) | — | `can_add` | — |
| Edit consignee / KYC | — | — | `can_edit` |
| Evidence Vault | `can_view` | — | — |

> Super-admins bypass checks. No-view users get a "No access" page.

---

## 3. BUSINESS PROCESS FLOW

### 3.1 Consignee lifecycle

```
┌───────────────────────────────────────────────────────────────────┐
│                       CONSIGNEE LIFECYCLE                           │
└───────────────────────────────────────────────────────────────────┘
                              START
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STEP 1: OPEN "ADD CONSIGNEE"                                       │
│  • /sales/consignee → Add Consignee   (standalone), OR             │
│  • Customer list → Map Consignee → Add Consignee (customer locked) │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  PHASE A: PICK PARENT CUSTOMER                                     │
│  • Searchable customer dropdown (name / id / segment / country)   │
│  • Confirm & Continue → enters the wizard, customer_id fixed       │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  (optional) SAME AS CUSTOMER  — tick the toggle                    │
│  • Copies Stage-1 identity + address book from the customer        │
│  • Only ONE mirror consignee allowed per customer                 │
│  • On Stage 1→2: clone-from-customer copies the customer's KYC     │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STAGE 1: CONSIGNEE LEGAL IDENTITY                                 │
│  Identification: company + legal name + website, Segment (multi),  │
│     Classification, Risk Level   (NO Customer Type, NO GST flag)   │
│  Address & Contact: primary address + contact + extra locations   │
│  → Save & Next  (POST /consignees on first save; PUT thereafter)  │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STAGE 2: KYC / DUE DILIGENCE                                     │
│  Sub-tabs: Company DD · Owner KYC · Trade Licence                │
│  • Segment rules surface required/optional docs (reference tables)│
│  • Upload docs → segment uploads (or the KYC sub-modals)          │
│  • If Same-as-Customer: KYC is cloned from the customer           │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STEP 5: EVIDENCE VAULT / USE IN SHIPMENTS                         │
│  • Evidence Vault → 5-tab document/signature view                 │
│  • Consignee becomes the ship-to on the shipment / trade docs     │
└───────────────────────────────────────────────────────────────────┘
```

### 3.2 What happens on create
| Action | Detail |
|---|---|
| Consignee code | `CN-` + sequence, **per client**; never reuses a soft-deleted code |
| Parent link | `customer_id` fixed from the picker (or the locked "Map Consignee" customer) |
| Primary address | Exactly one address `is_primary = true`; its `cp_email` mirrors to `consignees.primary_email` |
| Segment | Multi-select stored comma-separated |
| Same as Customer | If ticked, `same_as_customer = true` and the customer's identity/addresses are copied |

### 3.3 What "Same as Customer" does (detail)
| Trigger | Effect |
|---|---|
| Tick the toggle | Copies Stage-1 fields + the customer's additional locations into the form (guarded: one mirror per customer; toggle locks once you've hand-entered basics) |
| Stage 1 → Stage 2 while ticked | `POST /consignees/{id}/clone-from-customer` — copies the customer's **KYC documents + owners (with files)** into the consignee |
| Later customer edits | `ConsigneeKycMirror` keeps the mirror in step: core fields + addresses on customer save; KYC files re-mirrored on any customer document/owner change |
| Untick | On an unsaved consignee, clears the copied preview; on a saved one, keeps the values but unlocks the fields for manual editing |

---

## 4. SCREEN SPECIFICATIONS

### 4.1 Screen: Consignees (list) — `SalesConsignee.tsx`
```
┌───────────────────────────────────────────────────────────────────┐
│  Consignees                                        [+ Add Consignee]│
│  (emerald color strip · "What we are doing here" 4-step panel)      │
├───────────────────────────────────────────────────────────────────┤
│  [Search company / ID / customer ID / contact / email / segment…]  │
│  ┌───────────────────────────────────────────────────────────────┐│
│  │Sr│Cons ID│Cust ID│Company│Segment│Risk│Same-as-Cust│Contact│…│⋯││
│  │1 │CN-001 │C-001  │Bharat●│Dairy+2│Low │    Yes     │J.Doe  │…│⋯││
│  └───────────────────────────────────────────────────────────────┘│
│  Row actions: Edit · Evidence Vault                                │
└───────────────────────────────────────────────────────────────────┘
```
- **Columns:** Sr No, Consignee ID, **Customer ID** (parent), Company (truncated + tooltip), Segment ("+N" popover), **Risk Level** (colored pill), **Same as Customer** (Yes/No), Contact Person, Email, Contact No, Country, Actions.
- **Search** matches company/ID/customer-ID/contact/email/phone/segment/country/city/risk. **Pagination** auto-sizes to the viewport (min 10/page).
- **Row actions:** Edit (opens the form), Evidence Vault.

### 4.2 Screen: Add / Edit Consignee — `AddConsigneeModal.tsx`
**Phase A — Customer picker** (create only): a searchable customer dropdown; "Confirm & Continue" locks the `customer_id`.

**Phase B — 2-stage wizard:**
| Stage | Sub-tab | Fields |
|---|---|---|
| **1. Consignee Legal Identity** | **Identification** | Company Name*, Company Legal Name*, Website · Customer **Segment*** (multi), Classification*, Risk Level* — **(no Customer Type, no GST Applicable)** |
| | **Address & Contact** | Address Type (locked "Registered Office"), Address*, Country*, State*, City*, Pin (6-digit)*, Contact Person Name*, Designation*, Phone*, Email*, WhatsApp* · **Additional Locations** table |
| **2. KYC / Due Diligence** | **Company DD** | Segment-rule docs → Name, License #, Issuing Authority, Issue/Expiry, Attachment |
| | **Owner KYC** | Owner Name, Designation, Email, Phone + ID Proof / Address Proof / Photograph |
| | **Trade Licence** | Segment-rule trade-licence docs |

A **Linked Customer** panel shows the parent customer's details read-only (and, when Same-as-Customer is on and stage ≥ 2, KYC count cards). Validation mirrors the customer form. **Auto-save** persists Stage 1 (POST then PUT) before Stage-2 uploads.

### 4.3 Feature: Consignee Evidence Vault
`ConsigneeEvidenceVaultModal` (emerald-themed) — the same **read-only compliance archive** as the customer vault, from `GET /segment-uploads/consignee/{id}/vault`:
- **5 tabs:** Company Due Diligence · Owner KYC · Trade Licenses · Trade Documents (segment docs merged with live Zoho status) · Agreements/Shipments (per-shipment matrix, with a `buyer_is_consignee` marker).
- Header KPIs (Total / Verified-Signed / Pending / per-bucket), row actions (View · Download · Re-Upload · Send/Remind/Track/Certificate for trade docs), **Export All** (multi-sheet XLSX).
- **Verification is display-only** (upload ⇒ "Verified", else "Pending"; "Signed" from a completed Zoho request).
- **Same-as-Customer pass-through:** the vault for a `same_as_customer` consignee returns the **parent customer's** documents.

### 4.4 Reached from the Customer — "Map Consignee"
The customer list's **Map Consignee** opens `CustomerConsigneesModal` (lists the customer's consignees), whose **Add Consignee** opens `AddConsigneeModal` with `preselectedCustomerId` **locked** and the live `existingMirrorCount` (so the one-mirror rule is enforced immediately).

---

## 5. BUSINESS RULES

| # | Rule | Behaviour |
|---|---|---|
| 1 | Parent link | Every consignee belongs to exactly one Customer (`customer_id`, fixed at create) |
| 2 | Consignee code | Auto `CN-####`, unique per client; never reuses a soft-deleted code |
| 3 | One mirror | **Only one** `same_as_customer` consignee per customer (server-validated, 422 on violation) |
| 4 | Same-as-Customer copy | Copies identity + address book (Stage 1) and clones KYC on Stage 1→2 |
| 5 | Mirror upkeep | `ConsigneeKycMirror` re-syncs core fields/addresses on customer edit and re-mirrors KYC on customer document/owner change |
| 6 | Legal name / email / phone | Unique per tenant (same rules as Customer) |
| 7 | Pin code | Exactly 6 digits |
| 8 | Address strategy | Edit replaces the whole address set |
| 9 | Vault pass-through | A `same_as_customer` consignee's vault reads the parent customer's uploads; uploads to it are blocked |
| 10 | Tenant scoping | Every query scoped by `client_id` / `branch_id` from the authenticated user |
| 11 | Soft deletes | Consignees are soft-deleted (recoverable) |
| 12 | No GST scrutiny | Consignees have **no** GST-scrutiny feature (unlike Customer) |

---

## 6. STATUS MODELS

### 6.1 Consignee status
`Active` / `Inactive`.

### 6.2 Same as Customer (`same_as_customer`)
- **Yes** — a mirror of its parent customer; identity/addresses/KYC track the customer, vault reads the customer's docs, uploads blocked.
- **No** — a self-entered, independent consignee.

### 6.3 Document / signature statuses
Same as Customer — segment-upload rows are *Verified*/*Pending* (display-only); trade-doc signatures are `draft`/`inprogress`/`completed`/`declined`/`recalled`.

---

## 7. KNOWN LIMITATIONS (consignee-facing)

| Area | Limitation |
|---|---|
| One mirror | A customer can have at most one `same_as_customer` consignee |
| Mirror edits | On a same-as-customer consignee, identity/KYC are driven by the customer; local edits require unticking |
| No GST scrutiny | Unlike Customer, the consignee has no GST-scrutiny compliance panel |
| Verification | Evidence-Vault "Verified" is **display-only** (a file exists) — no reviewer approval step |
| Two doc stores | Segment uploads (vault) and ad-hoc `consignee_documents`/`consignee_owners` are separate |
| Address edits | Editing replaces all address rows (IDs not preserved) |
| Shipment tab | The Agreements/Shipments matrix is empty until the consignee is on a lead + shipment order |

---

*Related documents: CONSIGNEE_TECHNICAL_DOCUMENTATION.md · CONSIGNEE_CODE_WALKTHROUGH.md · CONSIGNEE_API_DOCUMENTATION.md*
