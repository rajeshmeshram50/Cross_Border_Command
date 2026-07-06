# LEAD WORKSHEET MODULE — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Sales Matrix → Lead Worksheet ("My Workplace") + Lead Distribution

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
The **Lead Worksheet** ("My Workplace") is the sales team's daily driver — a **combined list view + workspace** over every lead/opportunity. From one screen a salesperson or manager captures leads, qualifies them, assigns/distributes them across the team, filters and exports them, and drills into any lead's **6-stage opportunity pipeline**. It is the front door of the Sales Matrix: **lead → quotation → proforma invoice → shipment**.

Two things are deliberately **kept apart**:
- The **worksheet toolbar** — the top-level action buttons that operate on the *list* (Add Lead, Assign, Lead Distribution, Sync, Filter, Export). These sit **outside** the pipeline stages.
- The **6 pipeline stages** — Inquiry Received → Lead Acknowledgement → Product Sourcing → Price Shared → Quotation vs PI → Victory. These live **inside** the per-opportunity **Matrix Detail** view, opened by clicking a lead row.

### 1.2 Business Value

| Benefit | Description |
|---|---|
| One workspace | Every lead across statuses/stages in a single filterable, exportable list |
| Lead distribution | Managers assign/reassign leads to salespeople (single, bulk, or by filter) and monitor per-person load |
| Inbound automation | IndiaMart CRM sync pulls export enquiries automatically (India excluded — export-buyer focus) |
| Qualification workflow | Qualified / Disqualified / Key-Opportunity tabs + convert-to-qualified |
| Full audit | Every ownership change logged (generated / assigned / reassigned) |
| Tenant + role isolation | Leads scoped by `client_id`/`branch_id` and by sales visibility tier |

### 1.3 Key Features
- **Combined list + workspace** with status tabs, prioritized search, filter chips, auto-fit pagination, and Excel export.
- **Outside-the-stages toolbar** — Add New Lead · Assign Leads · **Lead Distribution** · Sync from IndiaMart · Filter · Export.
- **6-facet filtering** — Stage, Platform, Lead Type, Country, Customer, Date (with presets).
- **Lead Distribution** — a roster page with 4 KPI cards (Total Salespersons / Total Leads / Assigned / Unassigned) and per-salesperson lead counts; drill into any bucket.
- **Assignment** — single (row), bulk (selection), or by-filter (date/account) to a salesperson.
- **Qualification** — Qualified/Disqualified/Key-Opportunity tabs (Key Opp splits In-Progress vs Deal-Won); convert disqualified → qualified.
- **Row drill-in** — open the lead's Matrix Detail at its current stage; quick Details / Activity modals without leaving the list.

---

## 2. USER ROLES & PERMISSIONS

Gated by the **`sales.workplace`** permission (super-admin bypasses).
| Capability | Gate |
|---|---|
| See the worksheet | `can_view` |
| Add / edit / assign / convert | `can_edit` (server also enforces) |
| Assign Leads + Lead Distribution buttons | `canDistribute` flag from the API (currently open to all; server still applies hierarchy + Sales-department gates) |

**Visibility tiers** (server-side, `SalesVisibility`): admins see all in scope; an employee sees `self` (own leads), `team` (assigned by their HOD), or `all` (HOD/Director) — on top of `client_id`/`branch_id` tenant scope.

---

## 3. BUSINESS PROCESS FLOW

```
┌──────────────────────────────────────────────────────────────────────┐
│                        LEAD WORKSHEET FLOW                             │
└──────────────────────────────────────────────────────────────────────┘
  INBOUND                          TOOLBAR (outside the stages)
  ┌───────────────┐                ┌─────────────────────────────────┐
  │ Add New Lead  │──┐             │ Assign Leads · Lead Distribution │
  │ (manual)      │  │             │ Sync (IndiaMart) · Filter · Export│
  └───────────────┘  │             └─────────────────────────────────┘
  ┌───────────────┐  ▼                         │
  │ Sync IndiaMart│→ LEADS LIST (tabs: Qualified · Disqualified · All · Key Opportunity)
  └───────────────┘     │  search · filter chips · pagination
                        │
              ┌─────────┴───────────┐
              ▼                     ▼
      Assign to salesperson   Click a row → MATRIX DETAIL (6 stages)
      (single/bulk/filter)    ┌───────────────────────────────────────┐
              │               │ 1 Inquiry → 2 Lead Ack → 3 Sourcing →  │
              ▼               │ 4 Price Shared → 6 Quotation/PI →       │
      LEAD DISTRIBUTION       │ 8 Victory                              │
      (KPIs + per-person)     └───────────────────────────────────────┘
```

### 3.1 Lead lifecycle (stages)
`lead_stage_id` drives the pipeline. **6 stages are visible** in the UI (others exist in the data model but are hidden):

| # | Stage | Completion signal |
|---|---|---|
| 1 | **Inquiry Received** | Lead captured (manual or IndiaMart) |
| 2 | **Lead Acknowledgement** | ≥1 acknowledgement logged → sets Qualified/Disqualified |
| 3 | **Product Sourcing** | Products mapped + sourcing marked required/not-required (required ones procured) |
| 4 | **Price Shared** | Every product has ≥1 quoted (shared) price |
| 6 | **Quotation vs PI** | Proforma Invoice created + sent for signature |
| 8 | **Victory** | Shipment order created; `won_at` auto-stamped on entering Victory |

> Qualified/Disqualified are mutually exclusive; new leads default to **Qualified**. Entering Victory is **gated** — the opportunity must have a non-cancelled PI that has **at least been sent for signature** (a signature request exists) **or emailed** to the customer. The deal advances once the PI is *out for* e-signature; the system no longer waits for signing to complete.

### 3.2 Lead sources — how leads arrive

Every lead in the worksheet enters through **one of two doors**, and each is stamped with a **Lead Source** (`platform`) and a **Lead Type** (`query_type`) so you can tell where it came from.

| Source | How it arrives | Platform / Lead Source | Default state |
|---|---|---|---|
| **Manual entry** | A user clicks **Add New Lead** and fills the form (optionally auto-filling from an existing customer) | **`Offline`** (Lead Type *Manual*) | Qualified · Stage 1 |
| **IndiaMart CRM sync** | The **Sync from IndiaMart** button pulls inbound export enquiries from IndiaMart's CRM API | the configured **CRM-account label** (e.g. *Agrotech*, *Purvee*) | Stage 1; **Qualified only if the buyer's country is exportable** |

**How the IndiaMart pull works (functional view)**
- The **Sync from IndiaMart** button only appears when inbound sync is **configured for this tenant/branch** (otherwise it's hidden). Each configured **CRM account** becomes a Lead Source column value.
- Clicking it fetches the **last 7 days** of enquiries from IndiaMart and, per record: **de-duplicates** (the same enquiry re-synced updates the existing row instead of creating a copy), maps the sender's contact/company/product details onto the lead, and files it at **Stage 1 (Inquiry Received)**.
- **Export-buyer focus:** a synced lead is auto-**Qualified** only if the buyer's country is on the export whitelist; **India (IN) is intentionally excluded** (treated as *Disqualified*), because this CRM feed is for cross-border buyers.
- After the pull a summary toast reports **{created} new · {updated} updated · {disqualified} disqualified**; if a CRM key is expired or rate-limited that reason is surfaced (so a "0 fetched" is explained, not silent).
- New leads are attributed to the **acting user's branch** (or the configured sync branch); the automatically-allocated **`OPP-####`** code makes them first-class opportunities identical to manually-added ones.

> Until a lead is linked to a Customer, its sender details (name/phone/email/company/country) live **directly on the lead** (denormalized) — that's what the list columns show. Full endpoint/field detail is in the **API doc §6.2** and the **Code-Walkthrough §8**.

---

## 4. SCREEN SPECIFICATIONS

### 4.1 Screen: Lead Worksheet ("My Workplace") — `SalesLeadWorksheet.tsx`
```
┌──────────────────────────────────────────────────────────────────────────────┐
│  My Workplace   [+ Add New Lead][Assign Leads][Lead Distribution][Sync][Filter▾][Export▾] │
├──────────────────────────────────────────────────────────────────────────────┤
│  [ Qualified (n) ][ Disqualified (n) ][ All (n) ][ Key Opportunity (n) ]       │
│  [Search — ID, name, phone, email, product, country…]     · active-filter chips │
│  ┌────────────────────────────────────────────────────────────────────────────┐│
│  │☐│Lead Type│Lead Date│Source│Assigned To│WA│Opp ID│Customer│No│Email│Product│…│⋯││
│  └────────────────────────────────────────────────────────────────────────────┘│
│  Rows auto-fit to screen · Page X of Y                                          │
└──────────────────────────────────────────────────────────────────────────────┘
```
- **Tabs:** Qualified · Disqualified · All · **Key Opportunity** (Key Opp adds *In Progress* / *Deal Won* sub-tabs). Each shows a live count.
- **Table (14 cols):** ☐ · Lead Type · Lead Date · Lead Source · **Assigned To** · WhatsApp Status · Opportunity ID (star = Key Opp) · Customer Name · Customer Number · Customer Email · Product Name · Company · Country · Action.
- **Search** (250 ms debounce) matches ID/name/phone/email/product/company/country + salesperson + linked customer, server-side.
- **Row actions:** click row → **Matrix Detail** at its stage; 👁 Details; 🕑 Activity; assign icon (if unassigned); bulk-select → Assign / Convert-to-Qualified.
- **Pagination** auto-fits rows to viewport (or 10/25/50).

### 4.2 Outside-the-stages toolbar (the buttons you asked about)
| Button | Opens / does | Endpoint |
|---|---|---|
| **Add New Lead** | Create a manual lead (pick/auto-fill customer, sender details, product) | `POST /sales/leads` |
| **Assign Leads** | Assign the current filter/selection to a salesperson | `POST /sales/leads/assign` |
| **Lead Distribution** | Full roster page — KPIs + per-salesperson counts | `GET /sales/leads/salesperson-summary` |
| **Sync from IndiaMart** | Pull inbound enquiries (only if configured) | `POST /sales/leads/sync` |
| **Filter** | Open the 6-facet filter modal (badge = active count) | `GET /sales/leads/filter-options` |
| **Export** | Export All / Qualified / Disqualified / Key-Opportunity → XLSX | `GET /sales/leads` (paged) |

> These are **list-level** actions — none of them is a pipeline stage. The stages are only reached by opening a lead's Matrix Detail.

### 4.3 Filters (all facets) — `LeadFilterModal.tsx`
Two-pane modal (facet sidebar + options). Options load once from `GET /sales/leads/filter-options`.
| Facet | Query param | Type |
|---|---|---|
| **Stage Wise Lead** | `lead_stage_id[]` | multi (1,2,3,4,6,8) |
| **Platform** | `platform[]` | multi (Offline + configured CRM sources) |
| **Lead Type** | `query_type[]` | multi |
| **Country** | `sender_country_iso[]` | multi (ISO + name) |
| **Customer** | `customer_id[]` | multi (up to 500) |
| **Date** | `start_date` + `end_date` | single range + presets (Today, Yesterday, Last 7/30 Days, This/Last Month) |

Applied filters render as **removable chips** on the worksheet; a badge on the Filter button shows the active count. (`salesperson_id` is set separately by Lead Distribution's "View Leads".)

### 4.4 Screen: Lead Distribution — `AssignedLeadsModal.tsx` (`/sales/lead-distribution`)
A full-page roster titled **"Lead Distribution — Track and manage leads assigned to your sales team."**
- **4 KPI cards** (clickable → drill-down): **Total Salespersons · Total Leads · Assigned Leads · Unassigned Leads** ("Unassigned" = `salesperson_id IS NULL`).
- **Per-salesperson table (9 cols):** Sr No · Sales Person · Department · Designation · Primary Role · Ancillary Role · Reporting Manager · **Total Leads** · Action (**View Leads**).
- **View Leads** → `/sales/leads_details` filtered to that salesperson (`SalesLeadsDetails.tsx`).
- Sorted heaviest-loaded first; paginated.

### 4.5 Assignment modal — `AssignLeadsModal.tsx`
Three modes, all posting to `POST /sales/leads/assign`:
- **Single** — reassign one row (from the row's assign icon).
- **Selection** — assign the checked rows in bulk.
- **Filters** — pick Account (optional) + date range + salesperson; the system resolves the matching lead IDs and assigns them.

Salespeople come from `GET /sales/leads/salespeople` (the tenant's Sales-department employees). The response reports **new_assigned / reassigned / skipped_no_scope**.

---

## 5. BUSINESS RULES

| # | Rule | Behaviour |
|---|---|---|
| 1 | Opportunity code | Auto `OPP-####` per client (row-locked, unique) |
| 2 | Qualified vs Disqualified | Mutually exclusive; default Qualified; Stage-2 acknowledgement flips them |
| 3 | Victory gate | Can't reach Stage 6 unless a non-cancelled PI has been **sent for signature or emailed** (not necessarily signed) |
| 4 | `won_at` | Auto-set on entering Victory; cleared if the lead regresses below it |
| 5 | Unassigned | `salesperson_id IS NULL` |
| 6 | Assignment scope | Server enforces sales hierarchy + Sales-department membership; out-of-scope IDs are skipped |
| 7 | IndiaMart dedupe | Unique per `(client_id, platform, unique_query_id)`; **India (IN) leads excluded** |
| 8 | Audit | Every generate/assign/reassign written to `lead_assignment_histories` |
| 9 | Tenant + role scope | Every query scoped by `client_id`/`branch_id` and `SalesVisibility` tier |
| 10 | Soft deletes | Leads are soft-deleted (recoverable) |

---

## 6. STATUS MODELS
- **Qualification:** Qualified / Disqualified (mutually exclusive) · **Key Opportunity** flag (In-Progress vs Deal-Won by `won_at`).
- **Stage:** `lead_stage_id` 1–8 (visible: 1,2,3,4,6,8).
- **WhatsApp:** `pending` / `connected` / `not_connected` / `opted_out`.
- **Assignment activity:** `generated` / `assigned` / `reassigned`.

---

## 7. SMALL FEATURES & BEHAVIOURS (complete reference)

Every "little" behaviour on the worksheet, so nothing is missed in QA.

### 7.1 Worksheet list — micro-features
| Feature | Detail |
|---|---|
| **Lead-type labels** | Server codes are prettified: `BUY`→*Buy Leads* · `P`→*PNS Calls* · `W`→*Direct Enquiries* · `BIZ`→*Catalog-View Leads* · `WA`→*WhatsApp-Enquiries* · `B`→*Buy-Leads* · null/unknown→*Manual* |
| **WhatsApp status badge** | `connected`→**Connected** (green) · `not_connected`→**Not Connected** (red) · null/other→**Pending** (amber) |
| **Key Opportunity star** | A ⭐ badge on the Opportunity ID (tooltip *"Key Opportunity"*) whenever `key_opportunity = true` |
| **Auto-fit rows** | A ResizeObserver sizes rows-per-page to the viewport (`max(5, floor((height−40)/44))`); picking a value from the dropdown turns auto-fit off |
| **Rows-per-page** | Dropdown = current value + {10, 25, 50}; changing it resets to page 1 |
| **Search** | 250 ms debounce; matches *ID, name, phone, email, product, country* (server-side, ~25 columns + salesperson + customer); resets to page 1 |
| **Tab counts** | `counts` refresh on tab/search/filter/rpp change but **not** on page-only paging; the status tab itself doesn't constrain the counts, but active filters (platform/country/date) do. Key Opportunity carries `key_in_progress` + `key_won` sub-counts |
| **Sub-tab default** | Entering Key Opportunity always lands on **In Progress** first |
| **Active-filter chips** | One chip per selected value (*Stage/Platform/Type/Country/Customer/Salesperson/Date*); `×` removes a single value (or the whole field for single facets); **Clear all** wipes them; the Filter button shows a live count badge |
| **Return from Distribution** | `?sp=&sp_name=` auto-applies the salesperson filter, switches to the **All** tab, page 1, then strips the URL params |
| **No-access card** | Without `can_view`: *"Ask your branch admin to grant can_view on Sales Matrix → Lead Worksheet."* |
| **Empty / loading** | Skeleton shimmer rows while loading; *"No leads found"* when empty |

### 7.2 Row actions & bulk bar
| Action | Where | Notes |
|---|---|---|
| 👁 **View Lead Details** | row | Read-only card grid (`GET /sales/leads/{id}`) — see §7.6 |
| 🕑 **Activity Tracker** | row | Generation/ownership timeline (`GET /sales/leads/{id}/activity`) — see §7.7 |
| 👤 **Assign** | row | Single-lead assign modal (gated `can_edit` **and** `canDistribute`); pre-selects the current owner |
| **CTQ** | row (Disqualified only) | Convert-to-Qualified — see §7.3 |
| **Floating bulk bar** | appears when rows selected | *Assign Selected Leads* · *Convert to Qualified* (only on the Disqualified tab) · *Clear*. The header checkbox selects the whole page (indeterminate when partial) |

### 7.3 CTQ — Convert to Qualified (the small feature you flagged)
Two entry points: the per-row **CTQ** button (Disqualified rows only) and the floating bar's **Convert to Qualified** (Disqualified tab + selection).
- A **confirmation modal** shows the lead's **OPP-###**, and a 4-cell grid: **Customer · Lead Source · Product · Lead Date**, with the note *"Lead {OPP-###} will be moved from Disqualified to Qualified. This action can be reversed."*
- Confirm → `POST /sales/leads/convert-to-qualified { lead_ids[] }`. It sets `qualified=true`, `disqualified=false`, **and clears `lead_ack_reason_id` (null)** — the disqualification reason is removed so the lead is back in play. Response: `{ converted: N }`; toast *"{OPP-###} moved to Qualified"*; the list refetches.

### 7.4 View hierarchy (who sees / can assign whom)
Server-side, layered on top of `client_id`/`branch_id` tenant scope:
| Tier | Sees (list) | Can assign to |
|---|---|---|
| **Sales employee / intern** | own-assigned + unassigned leads | self, their reporting manager, their direct reports |
| **Sales manager (HOD)** | own + direct-reports' + unassigned | self + reporting chain (up/down) |
| **Client/Branch admin, super-admin** | all in scope | anyone in scope (`assignableUserIds = null`) |

Helpers: `SalesVisibility::applyToLeads()` (row narrowing), `assignableUserIds()` (self + manager + reports; null = admin), `salesDepartmentUserIds(user, branch)` (same-branch Sales-dept members), `canDistribute()` (admins + managers). **Assignment always additionally requires the target to be a Sales-department member in the same branch** (403 otherwise), and cross-tenant lead IDs are silently skipped (counted as `skipped_no_scope`).

### 7.5 Which stage blocks what
| Trigger | Rule | Result |
|---|---|---|
| **Advance to Stage 6 (Victory)** | Only on the forward move (currently `< 6`); needs a non-cancelled PI **sent for signature or emailed** | 422 with *"Create a Proforma Invoice…"* or *"Send the Proforma Invoice {code} for signature…"* |
| **Enter Stage 6** | first time | `won_at` stamped `now()`; regressing below 6 clears `won_at` (re-advancing keeps the original) |
| **Unmap a product** | `lead_stage_id ≥ 4` (Sourcing complete) | 422 — *"You can't unmap this product now — Product Sourcing (Stage 3) is already complete."* Must regress the lead first. **Cascade on allowed delete:** removes the product's shared-prices, sets `procurement_products.lead_product_id = null` (procurement survives, just delinks), then deletes the mapping |
| **Map a consignee** (with products) | segment flagged *Buyer ≠ Consignee not allowed* + consignee ≠ customer | 422 |
| **Map a customer** (with products) | every mapped product's segment must match one of the customer's segments | 422 |
| **Qualified + Disqualified both true** | mutually exclusive | 422 |
| **`lead_stage_id` out of range** | must be 1–6 (stages 7/8 aren't directly settable) | 422 |
| **`lead_ack_reason_id`** | must reference an **active** reason | 422 |
| **`salesperson_id`** | must not be a soft-deleted user | 422 |
| **`remark`** | capped at 5000 chars | 422 |

> **Signal-based stage filters (6 & 8):** the list treats **Stage 6 (Quotation vs PI)** as *"PI sent (signature request OR emailed) and not yet shipped"* and **Stage 8 (Victory)** as *"a shipment order exists"* — these don't map to the stored `lead_stage_id`.

### 7.6 Documents & PDFs generated (complete list)
| Output | Where | Format |
|---|---|---|
| **Shared-Price / Quotation PDF** | worksheet Stage-4 (`GET /sales/shared-prices/{id}/pdf?inline=`) | dompdf, **tenant-branded** (logo/address/GST/PAN/CIN/website), **Code-128 barcode `Q-#####`**, file `quotation_#{id}.pdf` |
| **Excel export** | Export dropdown | **XLSX** (not PDF), 12 fixed columns: Lead Type, Lead Date, Lead Source, Assigned To, WhatsApp Status, Opportunity ID, Customer Name, Customer Number, Customer Email, Product Name, Company, Country. Paged **200/req** across the whole bucket; buckets = **All / Qualified / Disqualified / Key Opportunity** (each shows its live count); *"Nothing to export"* if empty. The dropdown is portalled to `<body>` so the banner never clips it |

> The **Quotation PDF, Proforma-Invoice PDF, signed public links, and e-signature certificate** are produced inside **Stage 5** — documented in `../matrix-stages/` (not the worksheet).

### 7.7 Add-New-Lead, Details & Activity modals
- **Add New Lead** — a *"Take customer from existing sales database"* toggle: **off** = manual entry; **on** = pick a customer (`GET /customers?tab=all`) and auto-fill mobile/email/company/address/city/pincode/country/state (those fields lock; toggling back clears them). Required: Customer Name, **Mobile (6–15 digits)**, valid **Email**, City, Country, State. Country→State is a cascade (changing country resets state). Posts `sender_*` + `customer_id` to `POST /sales/leads`.
- **Lead Details** — read-only card grid: OPP ID/Date, Lead Type (violet chip), Lead Source (green chip), Assign To, Customer, Mobile, **Email (mailto link)**, Company, Country (chip), **Product (amber-highlighted)**, plus optional **Address** and **Stage** cards. Stage labels expose the hidden ones too: `5 Pre-PI CLM`, `7 Post-PI CLM`.
- **Activity Tracker** — newest-first timeline of **generated / assigned / reassigned** events with actor avatars, relative + exact timestamps, and (for reassignments) the old owner struck-through with an arrow to the new owner; *generated* rows show Source/Platform/OPP chips.

### 7.8 Lead Distribution & KPI drill-downs
- **4 KPI cards** — **Total Salespersons** (not clickable), **Total Leads**, **Assigned Leads**, **Unassigned Leads** (the last three are clickable → the KPI popup with filter `{}` / `{assigned:true}` / `{assigned:false}`).
- **Roster table** shows only salespeople **with ≥1 assigned lead**, but the header "Total Salespersons" counts **all** active Sales members. Enriched from the employees table (department, designation, primary/ancillary role, reporting manager); sorted heaviest-load first.
- **KPI / View-Leads tables** are 11-column and include **Shipment ID** and **PI Number** (from the latest non-cancelled PI's `bt_id` / `code`) — shown as *N/A* until a PI exists.
- **Assign modal** has three modes — **single** (row), **selection** (checked rows), **filters** (account + date range; it re-queries matching leads at `per_page=1000` then assigns). If no Sales-dept employees exist it shows *"Add a person to the Sales department (HR → Employees) before assigning leads."* The response reports **new_assigned / reassigned / skipped_no_scope**.

### 7.9 Opportunity-picker gates (list flags reused by Quotation/PI)
The list endpoint accepts gates used by the Create-Quotation/PI pickers: `lead_ack_complete` (Stage 2 done — qualified + ≥1 acknowledgement), Stage-4 done (every mapped product has ≥1 shared price), and `exclude_with_pi` (hide leads that already carry a non-cancelled PI, so you can't start a new quotation once a PI exists).

---

## 8. KNOWN LIMITATIONS
| Area | Limitation |
|---|---|
| India leads | IndiaMart sync intentionally excludes India (IN) — export-buyer focus |
| Distribution | `canDistribute` is currently open to all users (server still gates by hierarchy + Sales dept) |
| Sender data | Lead sender fields are denormalized on the lead (no separate lead-customer table) until a customer is linked |
| Stages 5 & 7 | Exist in the data model but are hidden from the filter/matrix UI |
| Shipment/PI columns | Some list views show "N/A" for Shipment ID / PI Number until those relations are joined |

---

*Related documents: LEAD_WORKSHEET_TECHNICAL_DOCUMENTATION.md · LEAD_WORKSHEET_CODE_WALKTHROUGH.md · LEAD_WORKSHEET_API_DOCUMENTATION.md*
