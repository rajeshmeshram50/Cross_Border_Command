# P2P SUPPLIER MANAGEMENT

## Functional Documentation & User Guide

**Module:** P2P Supplier Management  
**Menu Path:** Procure to Pay (P2P) → P2P Master Management → Supplier Management  
**Technology Stack:** Laravel, PHP, React, TypeScript, PostgreSQL  
**Backend:** Laravel REST APIs  
**Frontend:** React / TypeScript  
**Document Type:** Functional Documentation & User Guide  

---

## CONTENTS

1. Overview
2. Key Terms
3. Who Can Do What
4. Screen Map
5. Supplier List
6. Add a Supplier — Stage 1 (Legal Identity)
7. Add a Supplier — Stage 2 (KYC / Due Diligence) and Saving
8. Edit a Supplier
9. Map Products
10. Map Services
11. Supplier Evidence Vault
12. Convert to Supplier (from the Sourcing Tracker)
13. Other Scenarios
14. Supplier Status and Compliant Status
15. Business Rules

- Appendix A — Validation Reference
- Appendix B — Known Gaps
- Appendix C — Change Log

---

## 1. OVERVIEW

This document explains what the module does, who can do what, every screen, every rule and message, and the known gaps, in plain business language. It is written for business users, QA and new team members. The page opens at the URL /suppliers. Code-level detail is in the companion Technical Documentation, API Documentation and Code Walkthrough (which reference code by function or component name, not line number).

Supplier Management is the company's **master list of suppliers**. A supplier is added in two stages:

1. its **legal identity** — company details, Supplier Type, segments, address, GST or TIN, contact persons;
2. its **KYC / Due Diligence** — Company DD, Owner KYC and Trade Licence documents, bank accounts and, for Indian suppliers, GST scrutiny.

Which documents are asked for is decided by the supplier's **segments** and whether it is **Domestic or International**. Those rules live in the CLM **Document Control Panel**, not here.

Once saved, the supplier is linked to what it sells: a **Material / Goods** supplier is mapped to **products**, a **service** supplier to **services**, each with its own price and GST. Every supplier has an **Evidence Vault** that shows its one-time documents and, per deal, the trade documents and agreements that need signing. A supplier counts as **Compliant** only when every mandatory document is in and in date and every applicable agreement is signed.

Once a supplier is on a submitted Purchase Order or a Supplier Invoice, its Supplier Type and the segments in use are **locked**. Once it is on **any** Purchase Order, its Country, State, State Code and GST / TIN are locked in the form (the street address, City and Google Location stay editable).

Main capabilities:

- Add a Domestic or International supplier through a two-stage wizard.
- Upload the KYC / DD / Trade Licence documents its segments require; add bank accounts and GST scrutiny.
- Map products (Material / Goods suppliers) or services (service suppliers) with prices.
- See compliance at a glance on the list, and every document and signature in the Evidence Vault.
- Send trade documents, agreements and Purchase Orders for e-signature.
- Receive New Suppliers converted from the Sourcing Tracker.

**Not available:** deleting a supplier (there is no Delete button).

---

## 2. KEY TERMS

| Term | Meaning |
|---|---|
| Supplier | A company the business buys from. Code S- plus a number (S-001), numbered per branch |
| Domestic supplier | Primary address in **India** (or no country set). Has GST and a State Code |
| International supplier | Primary address **outside India**. Has a TIN instead of GST |
| Supplier Type | What the supplier provides — Material/ Goods, FFD/ Transporter, or a service type. Decides what it can be mapped to |
| Supplier Segment | The business category (from CLM segments). Decides which documents are required |
| Document Control Panel | The CLM screen where each segment's document rules are set, per origin |
| Stage 1 — Supplier Legal Identity | Identification, address and contact persons |
| Stage 2 — KYC / Due Diligence | Company DD, Owner KYC, Trade Licence, Bank Details, GST Scrutiny |
| Mandatory / Optional | Whether a document must be uploaded, as set in the Document Control Panel |
| Mapped Products / Services | The products or services the supplier sells, with a price each |
| Evidence Vault | One popup with the supplier's standard documents and its per-deal documents and agreements |
| Standard Documents | One-time documents: Company DD, Owner KYC, Trade Licences |
| Case to Case Documents | Per-deal trade documents and agreements, built from the supplier's Purchase Orders |
| Compliant / Non Compliant | Whether all mandatory documents are in and in date (and agreements signed once there is a PO) |
| Supplier Category | A rating: Star, General, High Risk or Blacklisted Supplier |
| Supplier Behaviour | How the supplier behaves (for example Genuine). Options come from the Supplier Behaviour master |
| New Supplier | A supplier found during sourcing, not yet in this master. Can be **converted** into one |
| Draft / Inactive / Active | The supplier's status on the server (not shown on screen) — see section 14 |

---

## 3. WHO CAN DO WHAT

| Action | Who can do it | What others see |
|---|---|---|
| See the menu item | A user with `p2p.supplier` **can_view** whose plan has not expired. Super admin and client admin have fixed menus without P2P | — |
| Open the page | **Branch users and employees** only. The URL itself is **not** checked against `p2p.supplier` — any branch user or employee can open `/suppliers` by typing it | Anyone else: *"Branch / Employee only — The Suppliers module is available only to branch users and employees."* |
| See a supplier | Their own branch's suppliers, their company's suppliers with no branch, and shared (company-less) suppliers. A client admin / client user sees every branch of the company | — |
| Add or edit a supplier | Anyone who can open the page — there is **no separate add / edit permission** and no department check | — |
| Map / edit / unmap a **service** | As above, **plus** the user must be allowed to edit that service | Refused (403), e.g. an employee working on a service another user created: *"<CODE>: You cannot edit this record — …"* |
| Delete a supplier | Nobody — there is no Delete button (the API has a delete, but nothing calls it) | — |
| Convert a New Supplier | From the Sourcing Tracker: anyone who can open the report. From Bulk Sourcing: the creator / assignee | — |

`p2p.supplier` **can_edit** is used outside this module: Create PO and Payment Request use it to decide whether a supplier can be edited from there.

---

## 4. SCREEN MAP

Everything is opened from the **list** or from **one row** on it.

```
P2P → P2P Master Management → Supplier Management        the LIST  (section 5)
      │
      ├─ Add Supplier ──► Domestic / International chooser ──► the wizard (sections 6–7)
      │                      Stage 1  Supplier Legal Identity
      │                         ├─ Supplier Identification & Address Details
      │                         └─ Contact Person Details
      │                      Stage 2  KYC / Due Diligence
      │                         ├─ Company Due Diligence · Owner KYC · Trade Licence
      │                         ├─ Bank Details
      │                         └─ GST Scrutiny            (domestic only)
      │
      ├─ Filter ─────────► Filter Suppliers (category, compliance)          (5.4)
      │
      └─ a row ──┬─ Segment "+N" ────────► Segments popup
                 ├─ Contact "+N" ────────► Contact Persons popup            (5.4)
                 ├─ Mapped Products / Services count
                 │      ├─ product supplier ─► Mapped Products  (section 9)
                 │      └─ service supplier ─► Mapped Services  (section 10)
                 ├─ Edit ────────────────► the wizard in edit mode         (section 8)
                 │      └─ Map Product / Service (header button)
                 └─ Evidence Vault ──────► Supplier Evidence Vault         (section 11)
```

Other places open the **same** Supplier form or vault (the behaviour is the one described here): Add Product's "+" next to Supplier, Create PO (Step 1, Step 2 and its Add Supplier flow), Supplier Invoice (Step 1), Payment Request (GST scrutiny), Service Management, the Sourcing Tracker (Supplier Master form and **Convert to Supplier**, section 12) and Bulk Sourcing's Sourcing Report (Convert to Supplier, and Edit of a Supplier Master row). See section 13.

---

## 5. SUPPLIER LIST

### 5.1 Purpose

Shows every supplier you can see, split by origin and type, with compliance at a glance. It is the starting point for adding, editing, mapping and the vault.

### 5.2 Who Can Do It

Branch users and employees (section 3).

### 5.3 Steps

1. Open **P2P → P2P Master Management → Supplier Management**. The title reads **Supplier Management** — *"Manage supplier onboarding, compliance verification, and product mapping for procurement readiness."*
2. Pick the origin tab (**Domestic Supplier** / **International Supplier**) and a type tab.
3. Search, or click **Filter** to filter by category and compliance.
4. On a row: **+N** in Segment or Contact Person, the **Mapped Products / Services** count, **Edit**, or **Evidence Vault**.
5. To add a supplier, click **Add Supplier** (section 6).

A guide panel **What We Are Doing Here** is **closed by default**. Its four steps: 01 Create Supplier · 02 KYC / Due Diligence · 03 Trade & Compliance Documentation · 04 Product Mapping.

### 5.4 Fields and Rules

**Origin tabs**

| Tab | Who is in it |
|---|---|
| **Domestic Supplier** (opens by default) | Primary address country is **India**, or no country is set |
| **International Supplier** | Primary address country is **anything other than India** |

There is no "All" origin tab. Each tab shows its count; switching tab resets the type-tab counts to 0 until the new counts arrive (so the old tab's numbers are never shown under the new one).

**Type tabs**

| Tab | Suppliers whose Supplier Type… |
|---|---|
| **All Suppliers** | any — suppliers with **no type yet appear only here** |
| **Material/ Goods Suppliers** | has a type that is not a logistics or service type |
| **FFD/ Transporter Suppliers** | contains *logist*, *transport*, *ffd* or *freight* |
| **Service Suppliers** | contains *service* |

**Search** — *"Search by supplier code, name, type, state, country, contact, phone or email…"*. It runs half a second after you stop typing and matches: company name, legal name, supplier code, primary email, GST number, supplier category, any contact's name / phone / email / city / state code, the primary state and country, the Supplier Type and the segment names. It has a clear (×) button.

**Filter → Filter Suppliers**

| Section | Options |
|---|---|
| **Supplier Category** — *Filter by supplier rating* | Star Supplier · General Supplier · High Risk Supplier · Blacklisted Supplier |
| **Compliant Status** — *Filter by KYC / compliance result* | Compliant · Non Compliant |

- Every option shows how many suppliers have it; an option with **0** is disabled (*"No supplier has this yet"*). An option already ticked can be unticked even if its count is 0.
- The footer shows a live *"N of M suppliers match"* (it waits ¼ second after each change). The subtitle names the current origin.
- **Nothing applies until Apply Filters.** Apply is disabled until the selection changes; it shows *"Applying…"* and waits for the list (Cancel and Esc are ignored meanwhile).
- Cancel, ×, Esc or a click outside throws the selection away. **Clear All** empties it.
- The Filter button shows a badge with the number of active filters.

**Columns**

| No. | Column | What it shows |
|---|---|---|
| 1 | **Sr. No** | Row number |
| 2 | **Supplier Code** | S-001, S-002… (numbered per branch) with the created date under it. A supplier without a code shows S- + its id padded to 3 digits |
| 3 | **Supplier** | Name, with *State, Country* under it |
| 4 | **Supplier Type** | Coloured pill, or "—" |
| 5 | **Segment** | First segment with its regulatory badge; **+N** opens all segments |
| 6 | **Location** | State, Country and *GST nn* (state code — hidden on the International tab) |
| 7 | **Contact Person** | Primary contact, phone and email; **+N** opens all contacts |
| 8 | **Supplier Category** | Star / General / High Risk / Blacklisted Supplier, or "—" |
| 9 | **Compliant Status** | **Compliant** (green) or **Non Compliant** (red) — see section 14 |
| 10 | **Mapped Products / Services** | A count. Click to open Mapped Products (product supplier) or Mapped Services (service supplier). 0 is not clickable |
| 11 | **Action** | **Edit** (pencil) and **Evidence Vault** |

FFD and untyped suppliers also show a **product** count, which opens Mapped Products — and when that count is above 0, **Map New Product** there lets more products be mapped to them (no Supplier Type check in that popup or on the server; see section 9 and Appendix B).

**Segments popup** (from **+N** in Segment): *"Segments (N)"*, each segment with its regulatory badge. It closes on a click outside, a resize, or a scroll outside it.

**Contact Persons popup** (from **+N** in Contact Person): title *"Contact Persons"*, sub-line *"<company> — N contacts"*. One row per contact: initial, name, a pill (**Primary**, the designation, or *"Contact"* when there is none), phone and email. Shown only with 2 or more contacts; contacts without a name are left out. It doesn't close on Esc.

**Layout and paging**

| Item | Behaviour |
|---|---|
| Above 820 px wide | The table fills the screen: the **page does not scroll**, rows scroll inside the table, the header row stays on top, the pager stays at the bottom, and when the table scrolls sideways the **Action** column stays pinned on the right |
| 820 px or less (phones) | The page scrolls normally and nothing is pinned |
| Rows per page | 10 / 25 / 50. Until a size is picked, the list fits as many rows as the screen allows (at least 10). A size picked by hand applies for this visit only; the next visit fits the screen again. At 820 px or less there is no fitting: the page size is the last fitted size saved in the browser, or 10 |

### 5.5 What Happens After Saving

The list has nothing to save. It reloads after a supplier is saved and when the Evidence Vault is closed (so an upload made there updates Compliant Status straight away).

### 5.6 Good to Know

- Any search, filter or tab change goes back to **page 1**.
- While loading, a shimmer shows; a failed load shows *"Load failed — Could not load suppliers"*.
- Empty list: *"No suppliers found"*.
- `/vendors` redirects to `/suppliers`.

---

## 6. ADD A SUPPLIER — STAGE 1 (LEGAL IDENTITY)

### 6.1 Purpose

Create the supplier: its company details, Supplier Type, segments, address, GST or TIN, and contact persons. The supplier gets its code (S-NNN) when Stage 1's first tab is saved.

### 6.2 Who Can Do It

Anyone who can open the page.

### 6.3 Steps

**Adding a supplier, end to end**

1. **Add Supplier** → pick **Domestic** or **International** → **Continue**.
2. Fill *Supplier Identification & Address Details* → **Save & Next** — the supplier is created (code S-NNN).
3. Fill the primary contact → **Save Contact** or **Save & Next**; add more contacts with **+ Add More Contact Person** (each saves at once).
4. Stage 2: upload each document the segments ask for on Company Due Diligence, Owner KYC and Trade Licence (each upload saves at once) → **Save & Next** through the tabs.
5. **Bank Details**: **+ Add More Bank** (at least one). Domestic: **Save & Next** moves to GST Scrutiny. International: Bank Details is the **last** tab, so its button is already **Save Supplier** (go to step 7).
6. *(Domestic)* **GST Scrutiny** — always the last tab: **+ Add GST Scrutiny** (at least one).
7. **Save Supplier** (the only button on the last tab) → the form closes and the list reloads.
8. Optional, any time after step 2: **Map Product / Service** in the header (sections 9–10).

**The Domestic / International chooser** — *"Choose the supplier's origin to continue"*:

| Card | Means | Effect on the form |
|---|---|---|
| **Domestic Supplier** — *registered and operating within India* | GST · PAN · Instant | Country is **India, locked**. GST Number and State Code are asked for |
| **International Supplier** — *registered and operating outside India* | Export Docs · Customs · Forex | Country list **excludes India**. TIN is asked for instead of GST |

**Continue** stays disabled until a card is picked (double-click a card to go straight on). The chooser is shown only when **adding**, never when editing. Esc, ×, Cancel and a click outside close it. Other modules can give it their own title and subtitle. At 560 px or less the two cards stack.

**The wizard**

| Stage | Name | Tabs |
|---|---|---|
| **1** | **Supplier Legal Identity** — *"Company, GST, PAN & contact"* (there is no PAN field — Appendix B) | Supplier Identification & Address Details · Contact Person Details |
| **2** | **KYC / Due Diligence** — Docs, identity & compliance | Company Due Diligence · Owner KYC · Trade Licence · Bank Details · GST Scrutiny *(domestic only)* |

Footer buttons: **← Previous**, **Save & Next →**, and **Save Supplier** on the last KYC tab (in edit mode: **Update & Next**, **Update Supplier**). From Stage 2 on, a collapsible *"What you did in previous stages"* panel recaps Stage 1. Clicking the **Contact Person Details** tab saves the identity tab first, exactly like Save & Next.

### 6.4 Fields and Rules

#### Supplier Identification & Address Details — Basic Company Details

| Field | Required | Rules |
|---|---|---|
| Company Name | Yes | Max 100. Only letters, numbers, spaces and `. , - ( ) & / ' %`; HTML and SQL-like text is removed as you type |
| Company Legal Name | Yes | Same as Company Name |
| **Supplier Type** | Yes | Grouped list — see below |
| Company Website | No | A valid web address — `https://example.com`, `www.example.com` and `example.com` are all accepted; no spaces, max 500 |
| **Supplier Segment** | Yes (1 or more) | See *Segments* below. "+" adds a new segment |
| Risk Level | Yes | From the Risk Level master |
| Supplier Behaviour | Yes | See *Supplier Behaviour* below |
| Supplier Category | No | Star Supplier · General (default) · High Risk · Blacklisted |

**Supplier Type list**

| Group | Types | Can be mapped to |
|---|---|---|
| — | **Material/ Goods** | **Products** |
| — | **FFD/ Transporter** | Nothing |
| — | **Soft Service Provider** | Soft / Digital services |
| Self Consumable Service Provider | **Trackable Services**, **Consumable Services** | Self-Consumable services (trackable / consumable) |
| Other Operational Service Provider | **Professional**, **Utility**, **Facility**, **Maintenance**, **Outsourcing Services** | Other Operational services of the same name |

**Supplier Behaviour** (from its master, commit `cdc5aff67`)

- The options are the **active** entries of the **Supplier Behaviour master** (Masters → Supplier Behaviour) that the user can see — own company + shared entries; for branch users and employees also limited to their branch or no branch. Each name shows once (names differing only in capitals or spacing count as one).
- Only when that gives **no active entry** (for example a new company) does the list fall back to the four standard values: Genuine · Cooperative & Responsive · Non Responsive & Inconsistent · Fraud Alert.
- A supplier's saved behaviour that has since been made inactive still shows (and stays selected) when the supplier is edited.
- The behaviour is saved **by name**. Saving a name the company does not have yet as its own entry (for example one that exists only as a shared / global entry) creates that entry in the company's Supplier Behaviour master.

**Segments**

- A segment can only be picked if the CLM **Document Control Panel** has a rule for it **for this supplier's origin** (Domestic or International). Segments without one are greyed out with the reason; each segment shows a **DOM**, **INT** or **+2** badge. The segments decide which KYC / DD / Trade Licence documents Stage 2 asks for.
- Precisely: a segment that has a rule **only for the other origin** is refused when added (*"Segment not allowed…"*) and again on Save. A segment with **no rule at all** is only greyed out in the dropdown — if it is already selected (a saved supplier, or a Convert to Supplier prefill) it is **not** flagged and saves.
- Both checks are in the **browser only**. The server only checks that each segment belongs to the company, and it silently drops a segment that has no company (a global segment) even though the list offers it (Appendix B).
- The **"+"** next to Supplier Segment opens the CLM segment form. A new segment can't be picked until a Document Control Panel rule is added for it (the toast says so).
- Removing a segment is blocked in the form when a product of it is on a **submitted** PO (submitted / sent for sign / signed / approved) or a committed Supplier Invoice (mapped / GRN pending / closed) — a draft PO does not lock a segment — when it has a mapped product, or when it has **any** uploaded document (optional ones too) — see section 8. If the server still finds documents only that segment uses, the form puts the saved segments back.

**Quick-add "+"** — only two fields have one: **Supplier Segment** (here) and **Product Name** in Map Product. Supplier Type, Risk Level, Supplier Behaviour and the other dropdowns show no "+". (The form contains code to add a Supplier Behaviour by name from a "+", but the field does not show a "+", so it can't be used.)

#### Supplier Address Details

| Field | Domestic | International |
|---|---|---|
| Registered Office Address | Required, max 200 in the form (the server allows 1000) | Same |
| Country | **India, locked** | Required, any country but India (also when editing — India is never in the list) |
| State | Required | Required |
| State Code | **Auto** from State, read-only (1–2 digit GST code) | — |
| GST Number | **Required** — valid 15-character GSTIN, must start with the State Code, unique in the company. Required / format / State Code are checked **in the form only**; the server accepts an Indian supplier with no GST Number (Appendix B) | — |
| Tax Identification Number (TIN) | — | **Required** — 3 to 30 letters, digits, `-` `/` `.` or spaces |
| City | Required, max 60; letters, spaces and `. , ' -` only (anything else is removed as you type) | Same |
| Google Location Link | Optional, must start with `http://` or `https://` | Same |
| Pincode | **No field on screen** (checked only if a value already exists) | Same |

GST Applicable is **not a field on screen** — it is set from the country (India = Yes, elsewhere = No).

#### Contact Person Details — Primary Contact Person

| Field | Required | Rules |
|---|---|---|
| Contact Person Name | Yes | Max 60; letters, spaces and `. , ' -` |
| Designation | Yes | Max 60; letters and `. , ' / -` |
| Contact No | Yes | Domestic: `+91` and **exactly 10 digits starting 6–9**. International: 7–15 digits |
| Email | Yes | Valid email, stored in lower case. Must be **unique across the whole system** |
| WhatsApp Enabled? | — | Switch, **on by default** |
| Attachment (Business Card) | No | JPG / PNG / WEBP / PDF, max 2 MB |

**Additional Contact Persons** — **+ Add More Contact Person** opens a popup with the same fields. Table columns: Sr No · Name · Designation · Phone · Email · WhatsApp · Attachment · Actions.

### 6.5 What Happens After Saving

**Identification tab — Save & Next**

- Saves the identity (*"Identity saved — Supplier identity details captured"*) and moves to Contact Person Details.
- From now on the supplier has its code (S-001…) and exists on the server with status *draft* (not shown in the list).
- If something is missing the toast lists the fields (*"Missing required fields — Please check: …"*); a wrong value gives *"Invalid value"* (one field) or *"Please fix these fields"* (several). Every message is in Appendix A.

**Contact Person Details**

- **Save Contact** saves and **locks** the primary contact (*"Saved — locked"*; toast *"Contacts saved — Address & contact persons captured"*). **Save & Next** on this tab does the same save and moves to Stage 2.
- Clicking the locked card shows *"Primary contact locked — Click the Edit icon on the primary row below to change it."* To change it, use the **Edit** icon on its row in the table.
- The primary contact can't be deleted (*"Primary contact locked — The primary contact can't be deleted here."*).
- Each additional contact is saved straight away (*"Contact saved"*). It can be **edited** (same popup; removing the attachment asks *"Remove Attachment?"*) and **deleted** (*"Delete Contact Person? … This action cannot be undone."*). Each change saves at once (*"Contact saved"* / *"Contact updated"*).

### 6.6 Good to Know

- The primary email is checked by the server against every company's suppliers and every New Supplier from sourcing: *"This email address is already used by another vendor or supplier in the system. Please use a different address."*
- Every additional contact must have its **own email** (*"Duplicate Email — This email is already used by another contact…"*) — checked in the browser only; the server checks only the primary email. Saving the primary contact does **not** check it against the additional contacts' emails.

---

## 7. ADD A SUPPLIER — STAGE 2 (KYC / DUE DILIGENCE) AND SAVING

### 7.1 Purpose

Collect the supplier's documents (as required by its segments and origin), bank accounts and, for a domestic supplier, GST scrutiny — then save the supplier.

### 7.2 Who Can Do It

Anyone who can open the page, once Stage 1 is saved.

### 7.3 Steps

1. On **Company Due Diligence**, **Owner KYC** and **Trade Licence**, click **Upload** on each row and attach the file. Each upload saves at once. **Save & Next** moves through the tabs.
2. On **Bank Details**, click **+ Add More Bank** and fill the popup. Add at least one.
3. *(Domestic)* On **GST Scrutiny**, click **+ Add GST Scrutiny**. Add at least one.
4. Click **Save Supplier** (or **Update Supplier** in edit mode) on the last tab.

### 7.4 Fields and Rules

#### Company Due Diligence · Owner KYC · Trade Licence

- The rows are the **documents the supplier's segments require** for its origin. If two segments ask for the same document it appears once, and it is **Mandatory if either segment says so**.
- **Older suppliers:** if a supplier still has rows saved by the old KYC form (legacy Company DD, Owner KYC or Trade Licence rows), that tab shows the old table of those rows **instead of** the segment-rule rows. Each tab decides on its own. A tab with neither shows an empty table.
- **Requirement** (Mandatory / Optional) comes from the Document Control Panel — it is shown, not chosen here.
- Columns: SR NO · AUTO CODE (e.g. DD-001) · document name · ISSUING AUTHORITY · ISSUE DATE · EXPIRY · REQUIREMENT · ACTIONS. A search box filters the rows; no match shows *"No documents match your search."*
- **Upload** opens *"Upload <Category> Document"* (*Due Diligence*, *KYC*, or — as the screen literally prints it — *TRADE LICENSE*):

| Field | Rules |
|---|---|
| Auto Code, Document Name, Issuing Authority | Shown, read-only |
| Issue Date | Optional, not in the future |
| Expiry | Yes / No. If Yes, a date not before today or the issue date |
| Upload Document | **Required** — **JPG / PNG / PDF**, max 2 MB, or take a photo. The popup's hint also says WEBP, and a .webp can be picked, but it is **refused** on submit with *"Unsupported file — Only JPG / PNG / PDF / DOC / DOCX files are allowed"*. DOC / DOCX are named in that message but can't be picked in any supplier upload |

- Checks: *"Expiry date required — Pick the expiry date, or switch Expiry to No."* · *"Dates out of order — The expiry date cannot be earlier than the issue date."* · *"File required"* · *"File too large"* · *"Unsafe file type blocked"*.
- After upload the row offers **View**, **Download** (with a spinner; *"Download failed"* on error) and **Re-upload** (saving a re-upload without a new file re-sends the current one).

#### Bank Details

**+ Add More Bank** — Bank Name, Branch, Account Number, IFSC Code (domestic) or SWIFT / BIC (international), Branch Address (optional), **Cancelled Cheque** (required in the form; the server would accept a row without it).

| Field | Rule |
|---|---|
| Account Number | Domestic 9–18 digits · International 8–34 letters / digits, no spaces · not repeated for the same supplier (checked in the browser and again on the server) |
| IFSC Code | 11 characters, e.g. HDFC0000123 |
| SWIFT / BIC | 8 or 11 characters, e.g. HDFCINBB / HDFCINBBXXX |

For an international supplier the SWIFT / BIC is stored in the same column as an IFSC code. **At least one bank account** is needed to move on or save the supplier.

#### GST Scrutiny (domestic only)

**+ Add GST Scrutiny** — GST Number (copied from Stage 1, read-only), GST Status (Active / Inactive, required), GST Last Filing Date (required, not in the future), Previous Non-GST 2A Reflected Invoice (max 50), Red Flags (max 300).

- **At least one record** is needed for a domestic supplier.
- The tab appears only when GST Applicable is Yes (domestic).
- If Stage 1 has no GST Number, the button explains it must be entered first (*"GST Number missing — Set GST Applicable to “Yes” and enter the GST Number on Supplier Identification (Stage 1) first."*).
- "Not in the future" for the filing date is checked only in the form.

### 7.5 What Happens After Saving

- A document upload is saved **straight away** (no success toast; the row shows View / Download / Re-upload). An error shows *"Upload failed — …"*.
- Each bank is saved straight away (*"Bank saved — <bank> (<branch>)"*). Each GST scrutiny record too (*"GST scrutiny saved"*). Saved bank and scrutiny rows **can't be edited or deleted** from the table.
- **Save & Next** on each Stage 2 tab shows *"<tab title> saved — <tab subtitle>"*, e.g. *"Company Due Diligence saved — Licenses, statutory documents, and compliance proofs"* (on the Bank tab of a **domestic** supplier: *"Supplier Bank Details saved — Account, IFSC, and cancelled cheque proof"*). The **last** tab (GST Scrutiny for domestic, Bank Details for international) shows only **Save Supplier / Update Supplier**.
- The first Save & Next in Stage 2 moves the supplier from *draft* to *inactive*, even with no document.
- **Save Supplier** checks the bank and GST scrutiny rules, saves everything and closes the form: *"Supplier saved — <code> — <name> completed and saved."* (edit mode: *"Supplier updated — …"*). The list reloads.
- Save Supplier also **re-saves the mapped products**, if any (an extra toast: *"Supplier saved — Products mapped — supplier is now Active"*, in edit mode too). Because this re-sends **every** mapped product, it fails if any of them has lost its GST rate since it was mapped (*"These products have no GST rate and cannot be mapped to a supplier — set a GST on the product first: …"*) — fix the product's GST, then save again.

### 7.6 Good to Know

- **Which missing files block Save & Next.** Only the older Company DD rows are checked (*"Upload required documents — Missing file on: <codes>"*). The segment-rule rows the tab actually shows, and Owner KYC / Trade Licence, are **not** checked — a supplier can pass Stage 2 with mandatory files missing; it then shows as **Non Compliant**.
- A document can only be attached once Stage 1 is saved (*"Save Step 1 first"*) — in practice Stage 2 can't be reached before that, so the message is not seen.
- After a failed **re-upload** the row shows **Upload** again until the form is reopened, even though the previously saved file is still there.
- "Expiry not before today" is checked only by the date picker; the server accepts a past expiry date.

---

## 8. EDIT A SUPPLIER

### 8.1 Purpose

Change a saved supplier, and map products or services to it.

### 8.2 Who Can Do It

Anyone who can open the page. Some fields lock once the supplier is used on a Purchase Order or Supplier Invoice.

### 8.3 Steps

1. List → **Edit** (pencil) on the row. The form opens as **Edit Supplier — S-xxx** and loads the saved supplier; if it can't, *"Load failed — Could not load the supplier — closing the form."*
2. Change what is needed on Stage 1 → **Update & Next** (saves the identity) → Contact Person Details → **Update & Next** (saves the contacts).
3. Stage 2: documents, banks and GST scrutiny save one by one as they are added; **Update & Next** walks the tabs.
4. **Update Supplier** on the last tab → *"Supplier updated — S-xxx — <name> completed and saved."* → the list reloads.

### 8.4 Fields and Rules

Everything in sections 6–7 applies, plus:

| Rule | What the user sees |
|---|---|
| **Country** of a domestic supplier can't change | Locked; clicking it explains GST and State Code are tied to India |
| **Primary contact** opens locked | Use Edit on its row to change it |
| **Supplier Type locks** once the supplier is on a **submitted** Purchase Order (submitted / sent for sign / signed / approved) **or a Supplier Invoice** (mapped / GRN pending / closed) | Dropdown disabled; its tooltip always reads *"Locked — this supplier is mapped to a Purchase Order"* (even when the lock comes from a Supplier Invoice); clicking it — *"Can’t change this — This supplier is already on a Purchase Order / a Supplier Invoice, so its Supplier Type is fixed."* The server refuses the change too |
| **State, State Code, Country and GST / TIN lock** once the supplier is on **any** Purchase Order (a draft too) | Tooltip *"Locked — this supplier is mapped to a Purchase Order"*; clicking — *"Can’t change this — This supplier is already used in a Purchase Order."* (form only — the server does not refuse) |
| A **segment can't be removed** while it is in use (a product of it on a submitted PO / committed Supplier Invoice, a mapped product of it, or any uploaded document of it — a draft PO does not lock a segment) | The segment is put back with *"Cannot remove segment — <name> — used on a Purchase Order."* · *"… — used on a Supplier Invoice."* · *"… — has a mapped product. Unmap it first."* · *"… — has uploaded documents. Delete them in KYC / Due Diligence first."* |

If the form lets a removal through but the server still finds documents that only the removed segment needs, saving shows *"Cannot remove segment — A document is uploaded against a segment you removed: <file> (<category>). Delete it in KYC / Due Diligence first, then remove the segment."* and the saved segments come back. The server also refuses a segment of a mapped product (*"This Segment cannot be removed because the Supplier is currently associated with one or more Products under this Segment. …"*) or of a product on a PO / Supplier Invoice (*"Cannot remove X — a product on a Purchase Order or Supplier Invoice belongs to it."*), shown as *"Save failed — …"*.

**The Map Product / Service button** — in the wizard header, in **Add mode too** once Stage 1 is saved.

| State | Button |
|---|---|
| Stage 1 not saved yet | Disabled — *"Save the Supplier Legal Identity step first…"* |
| **Supplier Type changed but not saved** | Disabled — *"Supplier Type changed — click Update & Next to save it, then map products or services"* |
| FFD/ Transporter, no type, or any type not in the fixed list | Disabled — *"Products or services can’t be mapped to this Supplier Type"* |
| Material/ Goods | **Map products to this supplier** |
| A service type | **Map services to this supplier** |

The button is **hidden** when the form is opened from: Add Product's "+", Service Management (add and edit), the Sourcing Tracker's Supplier Master form and Convert to Supplier, Bulk Sourcing's Convert to Supplier, and Create PO's Add Supplier flow.

### 8.5 What Happens After Saving

The same as sections 6.5 and 7.5, with *"Update"* in the button and toast texts.

### 8.6 Good to Know

- Mapping always follows the **saved** Supplier Type, so a supplier can never be mapped to the wrong kind of item by an unsaved change.
- A deep link `/suppliers?edit=<id>&return=<path>` opens this form directly — see section 13.

---

## 9. MAP PRODUCTS

### 9.1 Purpose

Link a **Material / Goods** supplier to the products it sells, with a purchase price.

### 9.2 Who Can Do It

Anyone who can open the page, for a supplier whose **saved** Supplier Type is Material/ Goods (and, through the list popup only, an FFD or untyped supplier that already has products — see 9.6).

**Which supplier maps what**

| Supplier Type | Opens | Picks from |
|---|---|---|
| Material/ Goods | **Mapped Products** | Products that have a segment, whose segment is one of the supplier's segments, not already mapped. The list has **no status filter** (draft and inactive products are offered too) and stops at the **newest 200** products |
| Soft Service Provider · Trackable / Consumable · Professional / Utility / Facility / Maintenance / Outsourcing Services | **Mapped Services** (section 10) | — |
| FFD/ Transporter (and untyped) | — | Nothing from the form's button. **But** if such a supplier already has mapped products (count > 0 in the list), the list's Mapped Products popup offers **Map New Product** and saves it — there is no Supplier Type check in that popup or on the server |

### 9.3 Steps

1. Open the popup — the list's count, or the form's **Map Product / Service** button.
2. **Map New Product** (list) / **Map Product** (form).
3. Pick the **Product Name** — code, HSN / SAC, segment and GST % fill in.
4. Type the **Purchase Price** — GST amount and total are worked out.
5. **Save** → the row appears (the popup jumps to the last page so the new row is visible).
6. To change a price, use **Edit** on the row.

| Opened from | Title | Rows per page | Add button |
|---|---|---|---|
| The list's count | **Mapped Products — S-xxx** | **10** | *Map New Product* in the header |
| The wizard's Map Product button | **Mapped Products** | **3** | *Map Product* in the body |

### 9.4 Fields and Rules

**Table** — columns: SR. NO · PRODUCT · PRODUCT CODE · HSN / SAC · SEGMENT · PRICE (₹) · GST % · GST (₹) · TOTAL (₹) · ACTIONS (Edit). **Search** covers product, code, HSN / SAC, segment, and **amounts** typed any way (1212, 1212.00, 1,212, ₹1,212, 18%).

**Map New Product form**

| Field | Rule |
|---|---|
| Product Name | Required. "+" opens Add Product; when it is saved the toast says *"Product created — Select X in Product Name to map it"*, or *"Not in the list yet…"* if it has no segment or a segment this supplier isn't on. "+" is hidden and the field locked when editing |
| Product Code, HSN / SAC Code, Segment | Auto from the product |
| Purchase Price (₹) | Required, 0 or more |
| GST % | Auto from the product, locked |
| GST Amount | Price × GST % ÷ 100 |
| Total | Price + GST Amount |

**A product with no GST rate can't be mapped** (CS-2327, commit `da7a6d271`):

- "No GST rate" means the product has no GST % chosen at all; a product whose GST is a real **0 %** can be mapped.
- The **wizard** version stops it before saving: *"GST required — <code> has no GST rate — set a GST on the product before mapping it to a supplier."*
- The **list** version has no such check in the form; the server refuses it: *"Save failed — These products have no GST rate and cannot be mapped to a supplier — set a GST on the product first: <product names>."*
- Because every save sends **all** the supplier's mappings, this message also appears when you add or edit a different product while an **already-mapped** product has lost its GST — fix that product's GST first.

**Checks by version**

| Check | Wizard version | List version |
|---|---|---|
| Product picked | Yes | Yes — *"Missing field — Pick a Product Name"* |
| Price entered | Yes | Yes — *"Missing field — Enter a Purchase Price"* |
| GST rate present | Yes | Server only |
| Segment match | Yes — *"Segment mismatch — … is in a segment this supplier isn't onboarded for."* | No |
| Duplicate | Yes — *"Already mapped — … is already mapped to this supplier"* | Server only |
| Non-negative price | Yes — *"Invalid price — Purchase Price must be a non-negative number"* | No |

In **both** versions the Product Name list already leaves out products that are mapped or outside the supplier's segments.

### 9.5 What Happens After Saving

- Success: list version *"Product mapped — X is now linked to S-xxx."* / *"Mapping updated — X has been updated for S-xxx."*; wizard version *"Product mapped — <code> <name> added"* / *"Mapping updated — <code> <name> updated"*.
- The supplier becomes **Active** with its first product.
- Saving a product mapping sets **every** product in the supplier's list to **active** — on every save (each one re-sends the whole list, including Save Supplier), so a product made **inactive** on purpose becomes active again.
- In the wizard, before Stage 1 is saved, a mapping is only kept in the form — no request is sent until Save Supplier.

### 9.6 Good to Know

- Product mappings are always in **₹ with the product's GST %**, also for an international supplier (no currency or exchange rate here). The "no GST rate" block applies to international suppliers too.
- The GST %, GST amount and total that are saved are the values the screen sends; the server does not recompute them from the product.
- A product can be mapped **once** per supplier.
- Every save sends the supplier's **whole** product list. If the list popup could not load the existing mappings and the user maps a product anyway, the save replaces all of them with just the new one.
- There is **no Unmap** for products in either popup.
- Empty states: *"No products mapped yet. Click "Map New Product" to begin."* · *"Could not load the mapped products. Close and try again."* · *"No mapped products match "…""*.

---

## 10. MAP SERVICES

### 10.1 Purpose

Link a **service** supplier to the services it provides, with a price (in ₹ with GST for domestic, in a foreign currency for international).

### 10.2 Who Can Do It

Anyone who can open the page, for a supplier whose saved Supplier Type is a service type — **and** who may edit the service (otherwise 403: *"<CODE>: You cannot edit this record — …"*).

### 10.3 Steps

1. Open the popup:
   - from the list count — title **Mapped Services — S-xxx**, with **Map New Service** in the header (only when the count is above 0, so a supplier's **first** service is mapped from the form);
   - or from the form's **Map Product / Service** header button — title **Mapped Services**, **Map Service** in the body (Add mode too, once Stage 1 is saved).
2. **Map Service** → pick the Service Name (code — name).
3. Enter the Price (international: pick the Currency first; its rate fills in and can be changed).
4. Optional Remarks → **Save** → *"Service mapped — <name> is now mapped to this supplier."*
5. **Edit** changes price, currency, rate and remarks. **Unmap** removes the service.

### 10.4 Fields and Rules

**Table** — domestic columns: SR. NO · SERVICE · SERVICE CODE · HSN / SAC · PRICE (₹) · GST % · GST (₹) · TOTAL (₹) · ACTIONS (Edit, Unmap). International: PRICE and TOTAL (₹ VALUE), **no GST columns**. **Search** covers service, code, HSN / SAC, and amounts (price, GST, total, ₹ value, `USD 120`, `18%`). No paging — every mapped service is listed; five show at a time and the rest scroll.

**Map Service form**

| Field | Domestic | International |
|---|---|---|
| Service Name | Required — unmapped services of the supplier's group (only **inactive** services are left out, so **draft** services are offered; at most the first 200 by name). Locked when editing | Same |
| Service Code, HSN / SAC Code | Auto | Auto |
| Currency | — | Required (any but INR); picking one fills its default rate |
| Price | Required, more than 0 | Required, more than 0, in the chosen currency |
| Exchange Rate (₹) | — | Required, more than 0 |
| GST % | Auto from the service | No GST |
| GST Amount / Total | Price × GST % ÷ 100 / Price + GST | Total = Price |
| ₹ Value | — | Total × Exchange Rate |
| Remarks | Optional, up to 1000 characters; the box grows to about five lines, then scrolls | Same |

- A service with no GST % can't be mapped to a domestic supplier — *"This service has no GST % yet — set it in Service Management first"* (form). The server checks the service's GST entry, so a service that shows a GST % without a linked GST entry is refused there: *"Map a GST % to this service first (Stage 1) — domestic suppliers use the service GST."*
- Form checks (after the first Save, toast *"Fill in the service details"*): *Select a service* · *Enter a price greater than 0* · *Select the supplier’s currency* · *Enter the exchange rate (₹ per unit)*.
- Server limits: price up to 9,999,999,999.99, rate up to 99999.9999, total up to ₹ 999,999,999,999.99.

### 10.5 What Happens After Saving

- Map: *"Service mapped — <name> is now mapped to this supplier."* A **draft** service becomes **active** (Stage 2 completed). The list count updates when the popup was opened from the list.
- Edit: *"Service updated — <name> has been updated for this supplier."*
- **Unmap** asks *"Unmap this service? <name> will no longer be mapped to this supplier. You can map it again later."* The mapping is made **inactive**, not deleted (*"Service unmapped — <name> is no longer mapped to this supplier."*).
- Mapping a service does **not** change the supplier's own status (section 14).

### 10.6 Good to Know

- A service can be mapped **once** per supplier.
- Every save re-sends all the supplier's active services. A save can therefore be refused because of an **already-mapped** service (e.g. the supplier's country or type changed, or a service lost its GST), or with *"<SERVICE CODE>: You cannot edit this record — …"* when the user may not edit one of them.
- Errors: *"Could not map the service — …"*, *"Could not update the service — …"*, *"Could not unmap the service — …"*. A load failure: *"Could not load the services. Close and open this popup to try again."*

---

## 11. SUPPLIER EVIDENCE VAULT

### 11.1 Purpose

One place to see — and complete — every document of a supplier: its one-time standard documents and, per deal, the trade documents and agreements that need signing.

### 11.2 Who Can Do It

Anyone who can open the page, from **Evidence Vault** on a row. When another screen opens the vault **read-only** (today only Payment Request), sending, uploading and ticking are hidden; View, Download, Send reminder, the tracker and the certificate stay.

### 11.3 Steps

1. Click **Evidence Vault** on a row. Header: *SUPPLIER EVIDENCE VAULT — <code> — <company>*, with chips for contact, city, type, segment, country and risk.
2. **Standard Documents**: pick a category tab, **View** or **Upload / Re-upload** a document.
3. **Case to Case Documents & Agreements**: pick the switch position, open a deal row, open a PO, and **View**, **Send for signature**, **Send reminder**, **Track** or download the **Certificate of Completion**.
4. **Sending for signature, step by step:** open the row → open the PO → on a document click **Send for signature** (or tick several in the PO's table and send them together) → the send popup opens with the signer (the supplier's contact) → **Send**. The status becomes **Sent** (overview: *Pending*), then **Signed** once the supplier signs in Zoho Sign.
5. **Export All** to download a ZIP, or **Close Vault**.

### 11.4 Fields and Rules

**Two groups**

| Group | What it holds | Overview button |
|---|---|---|
| **Standard Documents** — one time · KYC, DD & licences | Company Due Diligence · Owner KYC Details · Trade Licenses | *All Standard Document Overview* |
| **Case to Case Documents & Agreements** — per deal | Trade documents and agreements for each deal | *Send Documents & Agreements for Signature* |

#### Standard Documents

- Summary cards: total documents, uploaded, pending, and progress for each of the three categories.
- Table: Sr No · Document Name · License / Number (**Document Number** on the Owner KYC tab) · Issuing Authority · Requirement (★ Mandatory / Optional) · Issued Date · Expired At · Attachment · Status · Actions.
- **Expired At** turns **amber** within 30 days of expiry (tooltip *"Expires in N day(s)"*) and **red** once past (*"Expired N day(s) ago"*).
- Status: **Verified** (= a file is uploaded) · **Pending** (no file) · **Expired** (the expiry date has passed). "Expiring" is not a status — it is only the amber date. (**Signed** is used on Case to Case rows, not here.)
- Actions: **View**, **Upload / Re-upload**. The upload popup is the same as in the form (section 7.4, same messages); the vault then also refuses anything that is not PDF, JPG or PNG — *"Unsupported file type — Only PDF, JPG or PNG files are allowed. Word / Excel files are not supported."*
- **Standard Documents — Overview** lists every standard document in one table with its status and Download / Upload / Re-upload.

#### Case to Case Documents & Agreements

- Switch: **With Shipment ID Transactions** / **All Other Transactions (With Procurement ID)**.
- Summary cards: **With Shipment ID Transactions** and **All Other Transactions** (always both, whatever the switch; the ring counts deals whose KYC, DD, Trade Licence and Trade Docs are complete — agreements are not counted), then **Total Trade Documents**, **Total Agreements**, **Total Signed**, **Pending for Sign** (sent and not signed — declined, recalled and expired ones are counted here too) and **Not Sent for Signature**, which follow the switch.
- The rows are built from the supplier's **Purchase Orders** (not deleted):
  - **With Shipment ID** — one row per shipment that has at least one of the supplier's POs (Shipment ID, number of POs, supplier — there is no customer column).
  - **All Other Transactions** — one row per PO without a shipment (Procurement ID, PO ID, PO date and PO status).
- Each row shows KYC, Due Dil., Trade Lic., Trade Docs and Agreements as done / total with a percentage: **Complete** (100%), **Partial** (50% or more), **Missing**. KYC / DD / Trade Licence come from the supplier's standard documents; Trade Docs and Agreements count the PO documents that are **Signed**.
- The section header counts deals as **Complete** (everything done), **Partial** (some) and **Pending** (none) — a different rule from the cells above.
- Open a row to see its purchase orders (Procurement ID, PO ID, PO date, status, PO value, Trade Docs and Agreements ratios) and each PO's documents — the documents marked **necessary** in that PO's Stage 04 (the purchase order itself, trade documents and agreements).
- Document statuses: in the PO table a document reads **Signed**, **Sent** (sent and waiting), **Declined**, **Recalled**, **Verified** or **Pending** (not sent); the overview shows the same document as **Signed**, **Pending**, **Declined**, **Recalled** or **Expired**.
- Row actions: **View**, **Send for signature**, **Send reminder** (*"Reminder sent — The signer has been reminded to sign this document."*), **Signing activity tracker**, **Certificate of Completion** (signed CLM documents only — never on the purchase order row). Only one action runs at a time (*"Another action is still running"*).
- Rows can be **ticked and sent together** inside each PO's table — in the **All Other Transactions** view only; for shipment deals, tick and send them together from the **Send Documents & Agreements for Signature** overview instead.

**Sending rules**

- A PO row whose PDF is not generated yet has it generated first, then goes through the PO's signing; trade documents and agreements go through the CLM send-for-signature popup.
- **One envelope may hold trade documents, agreements and one PO.**
- Reminders go through CLM.
- Signature status re-syncs when the vault opens and when the browser window or tab becomes visible again.

**Overview** — pick a shipment / procurement (empty: *"No shipments or procurements for this supplier yet."*), then a document list with **Back to shipments** (shipment and procurement deals alike), per-row **View** (signed rows only), **Send** (**Resend** once a request exists), **Remind**, **Track**, **select all**, and a *"N of M selected"* bar with **Send N for Signature** (**Resend N for Signature** when every ticked row already has a request).

- A row that can't be ticked says why: *"Already signed"*, *"Already out for signature"* or *"Available once the document is saved against this deal"*.
- The bulk Send button, when disabled, says *"One of the ticked rows is not saved against this deal yet"* or *"One envelope carries one purchase order — tick just the one"*.

**Footer** — *Last updated: <date, time>* (or *"No documents uploaded yet"*) · *Vault managed by Compliance Team* · **Export All** · **Close Vault**. Esc and a click outside also close it.

### 11.5 What Happens After Saving

- Upload: *"Document uploaded — <file> has been attached."*; failure: *"Upload failed — …"*.
- Send: *"Sent for signature — N document(s) emailed to the signer."*
- **Export All** builds a ZIP in the browser, one folder per section, named *"<code> <company>.zip"*: *"Exported — N file(s) zipped · M had no attachment"*. Nothing to include → *"Nothing to export — There are no uploaded documents in this vault yet."*; failure → *"Export failed — Could not build the ZIP. Please try again."*
- **Close Vault** reloads the list so Compliant Status is current.

### 11.6 Good to Know

- A supplier with **no Purchase Order** has no Case to Case rows: *"No purchase orders against a shipment for this supplier yet."* / *"No other purchase orders for this supplier yet."*
- A PO with nothing marked shows *"<PO> has no documents — Nothing was marked necessary or unnecessary on this PO in Stage 04."*
- A document without a signature request takes its status from the PO document itself, so a row can read **Sent** (overview: *Pending*) or **Signed** even when no CLM request is linked to it.
- The two transaction cards count a deal as complete only when every category has at least one required document and all are in — a deal with **0** required documents in a category never counts as complete.
- Send refusals use the server's message, e.g. *"Submit the PO before sending documents for signature."*, *"No valid email for this supplier. Set a primary contact email on the supplier first."* A PDF that can't be generated: *"Could not prepare the purchase order — Its PDF could not be generated. Try again in a moment."*
- Where the list comes from: the supplier's Purchase Orders and the documents marked necessary on each PO's Stage 04. The summary cards count the rows of the switch position shown. (The Supplier trade documents and agreements defined in CLM for the supplier's segments decide **Compliant Status**, section 14 — they are not these rows.)
- A shared supplier with no company can't be loaded by the vault (the server answers "not found"); the vault then simply opens **empty**, with no message.

---

## 12. CONVERT TO SUPPLIER (FROM THE SOURCING TRACKER)

### 12.1 Purpose

Turn a **New Supplier** found during sourcing into a master supplier without retyping it: Sourcing Target Report → Mapped Suppliers → **Convert to Supplier**.

### 12.2 Who Can Do It

In the Sourcing Tracker **anyone who can open the report** (not only the target's creator / assignee); in Bulk Sourcing only the creator / assignee. The server checks no permission. The button shows only on **New Supplier** cards, never on Supplier Master cards, and is hidden once converted (also straight away in the same session).

### 12.3 Steps

1. Click **Convert to Supplier**. A loader shows *"Opening Add Supplier — loading <name>'s details…"*.
2. The Add Supplier form opens **already filled**: origin (the chooser is skipped), company and legal name, segment, address, country, state, state code, city, location link, and the contact's name, number and email (GST Applicable is *No* for an international one).
3. Fill what is still missing: Supplier Type, Risk Level, Supplier Behaviour, website, GST Number / TIN, the contact's Designation, and any attachment. (The New Supplier's business card is not shown in the form; it is copied at the end, step 6.)
4. Save Stage 1. **Map Product / Service is hidden** in this form.
5. Save **Contact Person Details** — with **Save Contact** on the primary contact card or with **Save & Next** (both send the same save). **The link is made here:** the New Supplier is marked converted and its sourcing mappings become Supplier Master mappings of the new supplier (a product that already has this supplier as a Master mapping keeps just the one row). From this moment the New Supplier counts as converted.
6. Carry on through Stage 2 as for any new supplier. On **Save Supplier** the tracker confirms the link once more and copies the New Supplier's business card onto the primary contact if that contact has no attachment yet: *"Converted to Supplier — <name> is now in the Supplier Master as S-xxx."* (<name> is the New Supplier's original name, not the company name typed in the form.)

### 12.4 Fields and Rules

- A prefilled segment that has a rule only for the **other** origin must be changed before Stage 1 can be saved; a prefilled segment with **no rule at all** is not flagged and saves.
- The segment is matched to the New Supplier's segment **by name**; if that match is a shared (company-less) segment, the server drops it on save and the supplier ends up with **no segment**.

| Case | What happens |
|---|---|
| Already converted | Info toast *"<name> is already in the Supplier Master — Its mappings show it as Master."* and the report reopens |
| The prefill can't load | *"Couldn’t open Convert to Supplier — <reason, or Please try again.>"* |
| The New Supplier is already linked to a **different** supplier | Saving Contact Person Details fails: *"This New Supplier cannot be converted into this supplier."* |
| Saved, but the new id didn't come back | *"Supplier saved, not linked — <name> was saved, but its id did not come back. Open Convert to Supplier again to link it."* |
| Saved, but the final link call failed | *"Supplier saved, not linked — <reason, or The supplier was saved but could not be linked. Please try again.>"*. The link itself was already made at the contacts step; what is missed is the business-card copy. The report is **not** refreshed on this path |
| The new supplier sits in another branch of the same company | Accepted — the final link call looks the supplier up by company, not by branch |
| Success | Two toasts (*"Supplier saved"*, then *"Converted to Supplier"*) and the report refreshes |

### 12.5 What Happens After Saving

A **Converted** badge stands where the button was, on the card of the (now Master) mapping.

### 12.6 Good to Know

- **Cancel before Contact Person Details is saved** leaves it a New Supplier and reopens the report — but if Stage 1 was already saved, an **unlinked draft supplier** (S-NNN) stays in the Supplier Master, the Convert button still shows, and converting again creates **another** supplier.
- **Cancel after** that step reopens the report too, but the New Supplier is already linked: its card shows **Converted**, and the new supplier stays in the Supplier Master (not yet finished — complete it later with Edit).

---

## 13. OTHER SCENARIOS

### 13.1 Opening the form from another module

| Opened from | What is different |
|---|---|
| **Add Product** — "+" next to Supplier | Add mode; no Map Product / Service button; the new supplier is offered in the product's supplier list |
| **Create PO** — Step 1 / Step 2 | Edit mode on the PO's supplier, so a product can be mapped to it in place |
| **Supplier Invoice** — Step 1 | Edit mode on the invoice's supplier, opened on **KYC / Due Diligence → GST Scrutiny** (like Payment Request) |
| **Payment Request**, **Create PO** — GST scrutiny | Opens straight on **KYC / Due Diligence → GST Scrutiny** (the GST tab waits until the supplier is known to be domestic) |
| **Service Management** | Add / edit a supplier while mapping it to a service |
| **Sourcing Tracker** | Add from the Supplier Master form; Convert to Supplier (section 12) |
| **Bulk Sourcing** — Sourcing Report | Convert to Supplier (the same link at the contacts step; its own toasts *"<name> added to Supplier Master"* / *"Supplier saved, but linking failed"*); Edit of a Supplier Master row |

Opening on a given step applies only in edit mode.

### 13.2 Deep link — `/suppliers?edit=<id>&return=<path>`

- Opens that supplier's Edit form over the list; `edit` and `return` are then removed from the address bar.
- After **saving**, the user is sent to `return` (only if it starts with `/`). **Cancel** stays on the list.
- An unknown or out-of-branch supplier: *"Supplier not available — This supplier isn’t available to edit from here — it may belong to another branch or has been removed from the Supplier master."* (another error: the server message or *"Could not open this supplier for editing."*), and the user is sent to `return` if one was given.
- An `edit` value that is not a positive number is ignored.

### 13.3 Deleting a supplier

There is **no Delete button** anywhere in the screens. The API has a delete (see the API document), but nothing calls it.

---

## 14. SUPPLIER STATUS AND COMPLIANT STATUS

### 14.1 Supplier status (server — not shown on screen)

| Status | When |
|---|---|
| Draft | Stage 1 saved |
| Inactive | First Stage 2 Save & Next (or Save Supplier), from Draft only |
| Active | At least one **product** mapped — from **any** status. The Map Product button works in Add mode right after Stage 1, so a supplier can go **Draft → Active** directly. Mapping the supplier from the Product side (Add / Edit Product → Map Supplier) also makes it Active |

- The sequence is therefore not strictly Draft → Inactive → Active.
- A **service** supplier **never becomes Active** through the screens — mapping a service does not change the supplier's status, and the Product side's Map Supplier offers only Material/ Goods suppliers.
- An FFD or untyped supplier normally stays Inactive too (but see section 9 for the list popup).

### 14.2 When is a supplier "Compliant"?

All of these must be true:

1. Every **mandatory** Company DD, Owner KYC and Trade Licence document (for the supplier's segments and origin) is uploaded and **not expired**.
2. **No uploaded document is expired** — an expired *optional* document also makes the supplier Non Compliant.
3. Once the supplier has a Purchase Order (**any** status, a draft included): every mandatory **trade document** is in, and every applicable **Supplier agreement** is fully signed and in date.

- A supplier whose segments define no document rules has no mandatory documents to miss — but it is still **Non Compliant** if any uploaded document has expired, or, once it has a PO, if an applicable Supplier agreement is unsigned.
- Applicable agreements come from the CLM Agreement Library (active agreements whose regulatory status and segment name / code match the supplier's segment and whose party is Supplier or blank), **not** from the Document Control Panel rules.

**Edge cases worth knowing when testing**

- If a segment has **no rule for the supplier's origin**, compliance falls back to whatever rule the segment does have.
- Compliance decides "Indian" by an exact match on the country name India; a supplier with **no country** is judged as **international** here, although the list shows it under Domestic.
- Closing the Evidence Vault reloads the list, so an upload made there updates this column straight away.

---

## 15. BUSINESS RULES

These are the rules QA should never see broken.

1. **Domestic = India.** A domestic supplier's country is India and can't be changed; an international supplier can't pick India.
2. **GSTIN** is required for a domestic supplier, is 15 characters, starts with the State Code, and is unique within the company.
3. **Segments need a Document Control Panel rule** for the supplier's origin.
4. **A supplier is Non Compliant** until every mandatory document is uploaded and in date (Stage 2's Save & Next does not fully enforce this — section 7.6).
5. **One bank account** is always required; **one GST scrutiny record** is required for a domestic supplier.
6. **Primary contact** can't be deleted; each **additional** contact's email must differ from the primary and the other contacts (form check). Saving the primary contact does **not** check it against the additional contacts' emails.
7. From the form's button: **products only for Material/ Goods**, **services only for service types**, **nothing for FFD/ Transporter** — always by the **saved** Supplier Type. (The list's Mapped Products popup does not check the type — section 9.)
8. **A product or service is mapped once** per supplier.
9. **Supplier Type locks** after a submitted PO or a Supplier Invoice; **Country, State, State Code and GST / TIN lock** after any PO (Registered Office Address, City and Google Location stay editable); a **segment in use** can't be removed.
10. **Compliant** means every mandatory document is in and in date, and (once there is a PO) every applicable agreement is signed.
11. **Filters apply only on Apply Filters**; Cancel throws the selection away.
12. **Above 820 px the list page does not scroll** — only the table rows do.
13. **Only a product mapping makes a supplier Active** — from this module, or from the Product side's Map Supplier.
14. **Supplier Behaviour** options come from the Supplier Behaviour master's active entries (the four standard values only when the master has none).

---

## APPENDIX A — VALIDATION REFERENCE

Every check a user can hit, by screen.

- **Where shown:** *field* = red text under the field (plus a summary toast on Save), *toast* = a pop-up message, *inline* = text inside a popup, *tooltip*, *page*.
- **Checked by:** *Browser* = checked before anything is sent; *Server* = refused by the server (shown as *"Save failed — <message>"* unless stated); *Both*.
- Toasts are written *Title — Body*.

### A.1 List

| Rule | Message | Where shown | Checked by |
|---|---|---|---|
| Page opened by a user who is not a branch user / employee | *Branch / Employee only — The Suppliers module is available only to branch users and employees.* | page | Browser |
| List can't load | *Load failed — Could not load suppliers* | toast | Browser |
| Filter option with 0 suppliers | *No supplier has this yet* (option disabled) | tooltip | Browser |
| Apply with no change | *Select a category or compliance status to filter by* (Apply disabled) | tooltip | Browser |
| Deep link to a supplier not available | *Supplier not available — This supplier isn’t available to edit from here — it may belong to another branch or has been removed from the Supplier master.* | toast | Browser (on a 404) |

### A.2 Stage 1 — Supplier Identification & Address Details

| Field | Rule | Message | Where shown | Checked by |
|---|---|---|---|---|
| Company Name / Legal Name | `<` `>` typed | *HTML characters (< or >) are not allowed* | field (removed as you type) | Browser |
| Company Name / Legal Name | SQL-like text | *SQL-like patterns are not allowed* | field | Browser |
| Company Name / Legal Name | other characters | *Use letters, numbers, spaces, and . , - ( ) & / ' % only* | field | Browser |
| Company Name | required | *Company Name is required* | field | Browser |
| Company Legal Name | required | *Company Legal Name is required* | field | Browser |
| Supplier Type | required | *Supplier Type is required* | field | Browser |
| Supplier Type | changed on a supplier on a committed PO / Supplier Invoice | *This supplier is already on a Purchase Order / a Supplier Invoice, so its Supplier Type can no longer be changed.* | toast | Server |
| Company Website | spaces | *Website cannot contain spaces* | field | Browser |
| Company Website | > 500 characters | *Website is too long (max 500 characters)* | field | Browser |
| Company Website | ftp: / file: / javascript: / mailto: | *Website must start with http:// or https://* | field | Browser |
| Company Website | not a web address | *Enter a valid website (e.g. www.example.com)* | field | Browser |
| Supplier Segment | none picked | *Select at least one supplier segment* | field | Browser |
| Supplier Segment | picked, has a rule only for the other origin | *Segment not allowed — <names> has no Domestic / International rule — this is a … supplier. Add the … rule in the Document Control Panel first.* | toast (segment removed) | Browser |
| Supplier Segment | on Save, a segment with a rule only for the other origin (a segment with **no** rule at all is not flagged — only greyed out) | *<names> has no Domestic / International rule — this is a … supplier, so the segment's document type must match.* | field | Browser |
| Supplier Segment "+" | segment created | *Segment created — <name> can't be selected until a rule is defined for it in the Document Control Panel.* | toast | Browser |
| Supplier Segment "+" | save failed | *Save failed — <message>* / *Could not save segment* | toast | Server |
| Risk Level | required | *Risk Level is required* | field | Browser |
| Supplier Behaviour | required | *Supplier Behaviour is required* | field | Browser |
| Registered Office Address | other characters | *Use letters, numbers, spaces, and . , - ( ) & / ' # % only* (and the HTML / SQL messages) | field | Browser |
| Registered Office Address | required | *Registered Office Address is required* | field | Browser |
| Country | required | *Country is required* | field | Browser |
| Country (domestic) | clicked | *Country is fixed — You chose Domestic, so this supplier is registered in India. …* (edit: *… GST and State Code are tied to India. …*) | toast | Browser |
| State | required | *State is required* | field | Browser |
| State Code (domestic) | required | *State Code is required* | field | Browser |
| State Code (domestic) | not 1–2 digits | *State Code must be a 1–2 digit GST code* | field | Browser |
| GST Number (domestic) | required | *GST Number is required* | field | Browser |
| GST Number | not a GSTIN | *GST Number must be a valid 15-character GSTIN — e.g. 29ABCDE1234F1Z5* | field | Browser |
| GST Number | first two digits ≠ State Code | *GST Number must start with the state code NN.* | field | Browser (the server check never runs) |
| GST Number | already used by another supplier of the company | *GST number X is already registered to another supplier.* (field: *This GST number is already registered to another supplier.*) | toast + field | Server |
| GST (India) | GST Applicable not Yes | *GST is mandatory for an Indian supplier — set GST Applicable to Yes.* | toast | Server (can't happen from the form) |
| TIN (international) | required | *Tax Identification Number (TIN) is required* | field | Browser |
| TIN | bad characters | *Tax Identification Number (TIN) may contain only letters, digits, hyphen, slash, period and spaces.* | field | Browser |
| TIN | < 3 / > 30 characters | *… must be at least 3 characters* / *… must be 30 characters or fewer* | field | Browser |
| TIN | missing / invalid | *Tax Identification Number (TIN) is required for an international supplier.* / *Tax Identification Number (TIN) is invalid.* (field: *TIN must be 3–30 characters: letters, digits, hyphen, slash, period and spaces only.*) | toast + field | Server |
| City | other characters | *Only alphabetic characters are allowed* | field | Browser |
| City | required | *City is required* | field | Browser |
| Google Location Link | not a full link | *Enter a full link starting with https://* | field | Browser |
| (summary) | only "is required" messages | *Missing required fields — Please check: <fields>* | toast | Browser |
| (summary) | any other message | *Invalid value — …* (one) / *Please fix these fields — …* (several) | toast | Browser |
| Locked field (supplier on a PO) | clicked | *Can’t change this — This supplier is already used in a Purchase Order.* | toast | Browser |
| Locked Supplier Type | clicked | *Can’t change this — This supplier is already on a Purchase Order / a Supplier Invoice, so its Supplier Type is fixed.* | toast | Browser |
| Segment removal | segment of a product on a **submitted** PO / committed SPI (a draft PO does not lock), of a mapped product, or with uploads | *Cannot remove segment — <name> — used on a Purchase Order.* · *… — used on a Supplier Invoice.* · *… — has a mapped product. Unmap it first.* · *… — has uploaded documents. Delete them in KYC / Due Diligence first.* | toast (segment put back) | Browser |
| Segment removal | documents only that segment needs | *Cannot remove segment — A document is / Documents are uploaded against a segment / segments you removed: … Delete it / them in KYC / Due Diligence first, then remove the segment.* | toast (segments put back) | Server (409) |
| Segment removal | a mapped product's segment | *This Segment cannot be removed because the Supplier is currently associated with one or more Products under this Segment. Please remove the Product dependency before removing this Segment.* | toast | Server |
| Segment removal | segment of a product on a PO / SPI | *Cannot remove X — a product on a Purchase Order or Supplier Invoice belongs to it.* | toast | Server |
| Success | — | *Identity saved — Supplier identity details captured* | toast | — |

### A.3 Stage 1 — Contact Person Details

| Field | Rule | Message | Where shown | Checked by |
|---|---|---|---|---|
| (step) | Stage 1 identity not saved | *Step blocked — Save Identity information first.* | toast | Browser |
| Contact Person Name | other characters | *Only alphabetic characters are allowed* | field | Browser |
| Contact Person Name | required | *Contact Person Name is required* | field | Browser |
| Designation | other characters | *Only letters, spaces, and . , - / are allowed* | field | Browser |
| Designation | required | *Designation is required* | field | Browser |
| Contact No | required | *Contact No is required* | field | Browser |
| Contact No | not digits | *Contact No must contain digits only (no spaces, +, or punctuation)* | field | Browser |
| Contact No (domestic) | not 10 digits | *Contact No must be exactly 10 digits (after +91) — you entered N* | field | Browser |
| Contact No (domestic) | first digit not 6–9 | *Contact No must start with 6, 7, 8 or 9 — Indian mobile numbers do not begin with X* | field | Browser |
| Contact No (international) | not 7–15 digits | *Contact No must be 7 to 15 digits* | field | Browser |
| Email | required | *Email is required* | field | Browser |
| Email | > 255 / not an email | *Email is too long (max 255 characters)* / *Enter a valid email (e.g. name@example.com)* | field | Browser |
| Email (primary) | used by any other supplier or New Supplier, in any company | *This email address is already used by another vendor or supplier in the system. Please use a different address.* | toast | Server |
| (Save Contact) | any field wrong | *Missing required fields — Please fix the highlighted fields* | toast | Browser |
| Primary card | clicked while locked | *Primary contact locked — Click the Edit icon on the primary row below to change it.* | toast | Browser |
| Primary row | delete clicked | *Primary contact locked — The primary contact can’t be deleted here.* | toast | Browser |
| Additional contact | fields missing | *Missing required fields — Please fill: <fields>* | toast | Browser |
| Additional contact | bad number / email | *Invalid Contact No — …* / *Invalid Email — …* | toast | Browser |
| Additional contact | email already used by another contact of this supplier | *Duplicate Email — This email is already used by another contact — each contact must have a unique email.* | toast | Browser |
| Convert to Supplier | New Supplier already linked elsewhere | *This New Supplier cannot be converted into this supplier.* | toast | Server |
| Success | — | *Contacts saved — Address & contact persons captured* · *Contact saved — <name> added* · *Contact updated — <name> updated* · *Contact deleted — Contact person removed* | toast | — |

### A.4 Stage 2 — KYC / Due Diligence

| Screen | Rule | Message | Where shown | Checked by |
|---|---|---|---|---|
| Upload popup | executable / script file | *Unsafe file type blocked — <name> — executable / script files are not allowed* | toast | Browser |
| Upload popup | not JPG / PNG / WEBP / PDF | *Unsupported file — Only JPG / JPEG / PNG / WEBP / PDF files are allowed* | toast | Browser |
| Upload popup | over 2 MB | *File too large — <name> exceeds the 2 MB limit* | toast | Browser |
| Upload popup | Expiry Yes without a date | *Expiry date required — Pick the expiry date, or switch Expiry to No.* | toast | Browser |
| Upload popup | expiry before issue date | *Dates out of order — The expiry date cannot be earlier than the issue date.* | toast | Browser |
| Upload popup | no file | *File required — Choose a document to upload.* | toast | Browser |
| Upload popup | re-upload, current file can't be fetched | *Could not keep the current file — Please pick the document again to re-upload.* | toast | Browser |
| Upload popup | a .webp (or anything not JPG / PNG / PDF / DOC / DOCX) on submit | *Unsupported file — Only JPG / PNG / PDF / DOC / DOCX files are allowed* | toast | Browser |
| Upload | server refused (type, size, dates, no file) | *Upload failed — <message>* (e.g. *Select a file to upload.*) | toast | Server |
| Document row | download failed | *Download failed — Could not download the file. Please try again.* | toast | Browser |
| Old (legacy) tables | file not JPG / PNG / PDF | *Unsupported file type — Only JPG, JPEG, PNG or PDF files are allowed.* | toast | Browser |
| Save & Next | legacy mandatory DD row without a file | *Upload required documents — Missing file on: <codes>* | toast | Browser |
| Bank popup | Bank Name / Branch / Account / IFSC / SWIFT / cheque missing | *Bank Name is required* · *Branch is required* · *Account Number is required* · *IFSC Code is required* / *SWIFT / BIC is required* · *Cancelled Cheque is required* | inline (no toast) | Browser |
| Bank popup | Branch characters | *Only letters and numbers are allowed* | inline | Browser |
| Bank popup | Account Number characters | *Only digits are allowed* (domestic) / *Only letters and digits are allowed* (international) | inline | Browser |
| Bank popup | Account Number format | *Account Number must be 9–18 digits* / *Account Number must be 8–34 letters or digits, with no spaces* (server: same text with a full stop) | inline / *Save failed* toast | Both |
| Bank popup | IFSC / SWIFT format | *IFSC Code must be 11 characters (e.g. HDFC0000123)* / *SWIFT / BIC must be 8 or 11 characters: 6 letters then alphanumeric (e.g. HDFCINBB or HDFCINBBXXX)* (server: *IFSC Code is invalid (format: 4 letters + 0 + 6 characters, e.g. HDFC0001234).* / *SWIFT / BIC is invalid …*) | inline / *Save failed* toast | Both |
| Bank popup | account already added for this supplier | *This account number is already added for this supplier.* | inline / *Save failed* toast | Both |
| Bank tab (domestic only) | Save & Next with no bank | *Bank Details required — Add at least one bank account before continuing.* | toast | Browser |
| GST Scrutiny | no Stage 1 GST Number | *GST Number missing — Set GST Applicable to “Yes” and enter the GST Number on Supplier Identification (Stage 1) first.* | toast | Browser |
| GST Scrutiny popup | GSTIN / filing date | *GST Number is required* · *GST Number must be a valid 15-character GSTIN — e.g. 29ABCDE1234F1Z5* · *GST Last Filing Date is required* | inline (no toast) | Browser |
| GST Scrutiny popup | Prev. 2A Invoice characters | *Only letters, digits, hyphens and slashes are allowed* | inline | Browser |
| GST Scrutiny popup | GSTIN used by another supplier | *GST number X is already registered to another supplier.* | toast | Server |
| Save / Update Supplier | no bank | *Bank Details required — Add at least one bank account before saving the supplier.* (opens the Bank tab) | toast | Browser |
| Save / Update Supplier | domestic, no GST scrutiny | *GST Scrutiny required — Add at least one GST Scrutiny record for a domestic supplier before saving.* (opens the GST tab) | toast | Browser |
| Save / Update Supplier | a mapped product has no GST rate | *Save failed — These products have no GST rate and cannot be mapped to a supplier — set a GST on the product first: <names>.* | toast | Server |
| Success | — | *<tab> saved — <subtitle>* (not on the last tab) · *Bank saved — <bank> (<branch>)* · *GST scrutiny saved — <GSTIN>* · *Supplier saved / Supplier updated — <code> — <name> completed and saved.* · *Supplier saved — Products mapped — supplier is now Active* | toast | — |

### A.5 Map Product / Service button and Mapped Products

| Rule | Message | Where shown | Checked by |
|---|---|---|---|
| Stage 1 not saved | *Save the Supplier Legal Identity step first to map products or services* | button tooltip (disabled) | Browser |
| Supplier Type changed, not saved | *Supplier Type changed — click Update & Next to save it, then map products or services* | button tooltip (disabled) | Browser |
| Type maps nothing | *Products or services can’t be mapped to this Supplier Type* | button tooltip (disabled) | Browser |
| No product picked | *Missing field — Pick a Product Name* | toast | Browser (both popups) |
| Product has no GST rate (form) | *GST required — <code> has no GST rate — set a GST on the product before mapping it to a supplier.* | toast | Browser (form popup only) |
| Product has no GST rate (any popup) | *Save failed — These products have no GST rate and cannot be mapped to a supplier — set a GST on the product first: <names>.* | toast | Server |
| Product in another segment | *Segment mismatch — <code> is in a segment this supplier isn't onboarded for.* | toast | Browser (form) |
| No price | *Missing field — Purchase Price is required* (form) / *Missing field — Enter a Purchase Price* (list) | toast | Browser |
| Negative price | *Invalid price — Purchase Price must be a non-negative number* | toast | Browser (form) |
| Product mapped twice | *Already mapped — <code> is already mapped to this supplier* / server *A product can only be mapped once per supplier.* | toast | Both |
| Mappings can't load (list) | *Load failed — Could not load the mapped products for this supplier.* | toast | Browser |
| Success | *Product mapped — …* · *Mapping updated — …* | toast | — |

### A.6 Mapped Services

| Rule | Message | Where shown | Checked by |
|---|---|---|---|
| Any form check failed | *Fill in the service details — <first error>* | toast | Browser |
| No service | *Select a service* | field | Browser |
| Price ≤ 0 | *Enter a price greater than 0* (server: *The price must be more than 0.*) | field | Both |
| Price too large | *The price cannot be more than 9,999,999,999.99.* | toast | Server |
| No currency (international) | *Select the supplier’s currency* (server: *Pick the supplier's currency — an International price is not in ₹.*) | field | Both |
| No rate (international) | *Enter the exchange rate (₹ per unit)* (server: *Enter the exchange rate (₹ per <CUR>).*) | field | Both |
| Rate ≤ 0 / too large | *The exchange rate must be more than 0.* / *The exchange rate cannot be more than 99999.9999.* | toast | Server |
| Service without GST (domestic) | *This service has no GST % yet — set it in Service Management first* / server *Map a GST % to this service first (Stage 1) — domestic suppliers use the service GST.* | field / toast | Both |
| Total too large | *The total value is too large (max ₹ 999,999,999,999.99). Check the price and exchange rate.* | toast | Server |
| Type does not serve the service | *Set this supplier's Supplier Type first — …* · *A <Type> supplier cannot supply a service. …* · *This supplier's type (<Type>) does not serve <X> — <CODE> needs a <X> supplier.* | toast | Server |
| Origin vs country | *This supplier is based in India — map it as a Domestic supplier.* / *This supplier is based in <country> — map it as an International supplier.* | toast | Server |
| Service mapped twice | *A service can only be mapped once per supplier.* | toast | Server |
| User may not edit a service | *<CODE>: You cannot edit this record — …* (edit / unmap: without the code) | toast | Server (403) |
| Popup can't load | *Load failed — Could not load the services for this supplier.* · *Could not load the services. Close and open this popup to try again.* | toast + body | Browser |
| Success | *Service mapped — …* · *Service updated — …* · *Service unmapped — …* | toast | — |

### A.7 Evidence Vault

| Rule | Message | Where shown | Checked by |
|---|---|---|---|
| Upload checks | as A.4, then *Unsupported file type — Only PDF, JPG or PNG files are allowed. Word / Excel files are not supported.* | toast | Browser |
| Upload failed | *Upload failed — <message>* / *The file could not be uploaded. Please try again.* | toast | Server |
| Row without a code / owner | *Save the record first* (Upload disabled) | tooltip | Browser |
| Another action running | *Another action is still running* | tooltip | Browser |
| PO has no documents | *<PO> has no documents — Nothing was marked necessary or unnecessary on this PO in Stage 04.* | toast | Browser |
| Two POs ticked (overview) | *One envelope carries one purchase order — tick just the one* | tooltip (send disabled) | Browser |
| Row not saved against the deal (overview) | *One of the ticked rows is not saved against this deal yet* / *Available once the document is saved against this deal* | tooltip | Browser |
| PO PDF can't be generated | *Could not prepare the purchase order — <message>* / *Its PDF could not be generated. Try again in a moment.* | toast | Server |
| PO send refused | *Submit the PO before sending documents for signature.* · *Some documents were not found on this PO.* · *Attach a file first: …* · *Already sent or signed: …* · *No valid email for this supplier. Set a primary contact email on the supplier first.* | toast | Server |
| CLM send refused | *No accessible documents in the selection.* · *The purchase order PDF is not ready yet. Open Stage 04, wait for it to generate, then send again.* · *Zoho Sign is not configured…* | toast | Server |
| Reminder refused | *Reminder cannot be sent. Current status is '<state>'.* / *Could not send reminder* | toast | Server |
| Export | *Nothing to export — There are no uploaded documents in this vault yet.* · *Export failed — Could not build the ZIP. Please try again.* | toast | Browser |
| Success | *Document uploaded — …* · *Sent for signature — N document(s) emailed to the signer.* · *Reminder sent — …* · *Exported — …* | toast | — |

### A.8 Convert to Supplier

| Rule | Message | Where shown | Checked by |
|---|---|---|---|
| Already converted | *<name> is already in the Supplier Master — Its mappings show it as Master.* | toast (info) | Server (prefill) |
| Prefill failed | *Couldn’t open Convert to Supplier — <reason / Please try again.>* | toast | Server |
| New Supplier linked to another supplier | *This New Supplier cannot be converted into this supplier.* | toast (contacts step) | Server |
| Id not returned | *Supplier saved, not linked — <name> was saved, but its id did not come back. …* | toast | Browser |
| Final link failed | *Supplier saved, not linked — <reason / The supplier was saved but could not be linked. Please try again.>* (server reasons: *Save the supplier in the Supplier Master first.* · *Unknown supplier in the Supplier Master.* · *“<name>” is already converted to another supplier in the Supplier Master.*) | toast | Server |
| Success | *Converted to Supplier — <name> is now in the Supplier Master as S-xxx.* | toast | — |

---

## APPENDIX B — KNOWN GAPS

These are how the screens behave now; they are listed so testers don't log them as new findings without checking with the team. The **No.** is the original gap number, kept for reference. Impact is a guide for prioritising: **High** = wrong data or a blocked task; **Medium** = confusing or weaker control; **Low** = cosmetic or wording.

### B.1 Supplier form — fields and masters

| No. | Gap | Impact |
|---|---|---|
| 1 | The wizard step says *"Company, GST, PAN & contact"*, but there is **no PAN field** | Low |
| 5 | The **server** does not re-check that the GSTIN starts with the State Code (the form does) | Medium |
| 17 | The "segment needs a Document Control Panel rule for this origin" check is in the **browser only**. The server only checks that the segment belongs to the company, and silently drops a **global** segment (one with no company) that the list offers | Medium |
| 19 | Supplier Type "kind" is decided two ways: the list and the form read the type **name** (contains *service*, *logist*…), the server reads the type's stored service type. A renamed or tenant-made type can land in different buckets. A type sent by name reuses an existing row of that name even if it is **Inactive** | Medium |
| 29 | Picking a Supplier Behaviour that the company has only as a shared / global master entry creates a copy of it in the company's own master on save; a name that differs only in capitals or spacing also creates a new entry | Low |
| 32 | The server does not require a GST Number for an Indian supplier (an empty one is accepted); only the form requires it | Medium |
| 33 | A segment with **no** Document Control Panel rule at all is only greyed out in the list; if it is already selected (saved supplier, Convert prefill) it saves without a warning | Medium |
| 36 | A Supplier Behaviour created by a save is stored with the user's branch, so it may not appear for users of other branches | Low |
| 37 | A save refused by the server can still have created a new master entry: a **Supplier Type** entry even when refused for a locked type, a bad TIN / GST or a segment removal; a **Supplier Behaviour** entry when refused for a bad TIN / GST or a segment removal (it is created after the type-lock check) | Medium |
| 39 | The Supplier Type lock tooltip always says *"…mapped to a Purchase Order"*, also when the lock comes from a Supplier Invoice | Low |
| 44 | Saving the primary contact does not check its email against the additional contacts' emails | Low |

### B.2 Stage 2 — documents, bank and GST scrutiny

| No. | Gap | Impact |
|---|---|---|
| 3 | **Bank Details** and **GST Scrutiny** rows can't be edited or deleted once added (no actions column) | Medium |
| 4 | Company DD, Owner KYC and Trade Licence have **no "+ Add"** for extra documents — the rows come only from the segment rules | Low |
| 7 | Stage 2's **Save & Next** checks missing files only on the older Company DD rows, not on the segment-rule rows the tab shows, nor Owner KYC / Trade Licence | Medium |
| 8 | The upload popup says **WEBP** is allowed, but a .webp is refused on submit | Low |
| 11 | *(Removed — the bank table's attachment cell has no clear control, so a saved cheque cannot be cleared from the table at all.)* | — |
| 20 | Adding or editing a GST Scrutiny record re-writes the GSTIN on every scrutiny row of the supplier, but **not** the supplier's own GST Number from Stage 1 | Low |
| 28 | Stage 2 (form) and the Evidence Vault / Compliant Status can list a slightly different set of documents for the same supplier: the form reads the segment's rule for the exact origin, the vault and compliance fall back to the segment's other rule when there is none | Medium |
| 38 | After a failed re-upload in Stage 2 the row shows **Upload** until the form is reopened, although the old file is still saved | Low |

### B.3 Product mapping

| No. | Gap | Impact |
|---|---|---|
| 2 | **Unmap Product** is not reachable from Supplier Management — the Mapped Products popups offer Edit only | Medium |
| 12 | The server does not check a mapped product's segment or status. The form checks the segment only; draft and inactive products are offered, and the product list stops at the newest **200** products | Medium |
| 18 | Saving the supplier's product mappings from this module re-creates every mapping without its origin, currency, exchange rate and ₹ amount, so values written from the Product side (Add / Edit Product → Map Supplier) are wiped | High |
| 21 | **Product GST rule and old mappings.** Every product save (Map Product in either popup, and Save / Update Supplier when products are mapped) sends all the supplier's mappings, and the server refuses the whole save if **any** of those products has no GST rate. A product that lost its GST after being mapped therefore blocks every later product change and the supplier's Update | High |
| 22 | The list's Mapped Products popup has no "no GST rate" check of its own (the server message is shown); the form's check is skipped for a product beyond the 200 loaded | Low |
| 23 | If the list's Mapped Products popup fails to load the existing mappings, **Map New Product** still works — and the save then replaces all existing mappings with just the new one | High |
| 31 | An **FFD or untyped** supplier that already has mapped products (count > 0) can be given more products from the list's Mapped Products popup — neither the popup nor the server checks the Supplier Type | Medium |
| 40 | Product mappings take the GST %, GST amount and total sent by the screen; the server does not recompute them. International suppliers' products are priced in ₹ with the product GST | Medium |
| 41 | Every product-mapping save sets all listed products **active**, re-activating products made inactive on purpose | High |
| 45 | The "a product with no GST can't be mapped" rule applies only when mapping from **Supplier Management**. Mapping a supplier from the **Product** side is not checked: it saves the product at 0 % GST, and from then on every product save for that supplier in Supplier Management is refused until the product gets a GST rate | High |

### B.4 Service mapping

| No. | Gap | Impact |
|---|---|---|
| 6 | The list's service count is matched on the supplier's **name** and reads only the first 200 services; a dedicated count from the backend is pending | Medium |
| 30 | The first service of a supplier can't be mapped from the list (the count 0 is not clickable) — only from the Edit / Add form's header button | Low |

### B.5 Status and compliance

| No. | Gap | Impact |
|---|---|---|
| 9 | A **service** supplier never becomes **Active** through the screens — only a product mapping does that (here or from the Product side, whose Map Supplier offers Material/ Goods suppliers only). An FFD or untyped supplier can become Active only through the list popup's loophole (No. 31) | Medium |
| 15 | Compliance treats a supplier with **no country** as international and counts a **draft** PO as "has a PO" | Medium |
| 25 | An agreement signed in the **same envelope as a trade document** is not counted as a signed agreement for **Compliant Status** | Medium |
| 43 | The transaction cards in Case to Case never count a deal as complete when a category has no required document | Low |

### B.6 Evidence Vault

| No. | Gap | Impact |
|---|---|---|
| 26 | Case to Case: in the tab view, ticking several documents to send together works only in **All Other Transactions** (the With Shipment ID view has no tick boxes); for shipment deals use the **Send Documents & Agreements for Signature** overview, which has select-all and bulk send | Low |
| 27 | A purchase-order row's **View** in the vault opens the unsigned PDF, and it never offers a Certificate of Completion | Low |
| 42 | A shared supplier with no company opens an **empty** Evidence Vault with no message | Low |

### B.7 Convert to Supplier

| No. | Gap | Impact |
|---|---|---|
| 24 | In the Sourcing Tracker, **Convert to Supplier** is shown to anyone who can open the report (not only the target's creator / assignee), and the convert calls check no permission | Medium |
| 34 | The supplier is created at Stage 1. Cancelling **before** Contact Person Details is saved leaves an unlinked *draft* supplier (S-NNN) in the master, the New Supplier still shows **Convert**, and a retry creates **another** supplier | Medium |
| 35 | The segment is matched by name; when it matches a shared (company-less) segment, the server drops it and the supplier is saved with **no segment** | Medium |

### B.8 Access and data

| No. | Gap | Impact |
|---|---|---|
| 10 | There is **no Delete** button for a supplier | Low |
| 13 | The Country / State / State Code / GST lock after a PO is enforced **only in the form**; the server accepts the change | Medium |
| 14 | A supplier in **another branch of the same company** can be read, uploaded to and deleted through the document-upload URLs | High |
| 16 | `/suppliers` opens for **any** branch user or employee who types the URL — the route does not check `p2p.supplier` can_view (only the menu item does) | Medium |

---

## APPENDIX C — CHANGE LOG

| Date | Change |
|---|---|
| 24-Nov-2026 | Restructured into the standard layout (Purpose · Who · Steps · Fields and Rules · After Saving · Good to Know per feature; validation and gaps as appendices). Supplier Behaviour from its master (commit `cdc5aff67`) is now described as current behaviour |
| 23-Nov-2026 | Content verified against the code (product with no GST can't be mapped — CS-2327, `da7a6d271`) |

---

## END OF DOCUMENT

| Item | Covered |
|---|---|
| Overview, terms, access, screen map | Sections 1–4 |
| Supplier list | Section 5 |
| Add a supplier (Stage 1, Stage 2, saving) | Sections 6–7 |
| Edit a supplier, locks, Map button | Section 8 |
| Product and service mapping | Sections 9–10 |
| Evidence Vault | Section 11 |
| Convert to Supplier | Section 12 |
| Other scenarios, deep link | Section 13 |
| Status and compliance | Section 14 |
| Business rules | Section 15 |
| Every validation message | Appendix A |
| Known gaps (45, grouped, with impact) | Appendix B |

**Related documents:** Supplier Management Technical Documentation · API Documentation · Code Walkthrough.
