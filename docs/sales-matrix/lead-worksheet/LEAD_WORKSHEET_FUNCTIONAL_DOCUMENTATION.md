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

> Qualified/Disqualified are mutually exclusive; new leads default to **Qualified**. Entering Victory is **gated** (a non-cancelled, signed PI must exist).

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
| 3 | Victory gate | Can't reach Stage 6 without a non-cancelled, signed PI |
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

## 7. KNOWN LIMITATIONS
| Area | Limitation |
|---|---|
| India leads | IndiaMart sync intentionally excludes India (IN) — export-buyer focus |
| Distribution | `canDistribute` is currently open to all users (server still gates by hierarchy + Sales dept) |
| Sender data | Lead sender fields are denormalized on the lead (no separate lead-customer table) until a customer is linked |
| Stages 5 & 7 | Exist in the data model but are hidden from the filter/matrix UI |
| Shipment/PI columns | Some list views show "N/A" for Shipment ID / PI Number until those relations are joined |

---

*Related documents: LEAD_WORKSHEET_TECHNICAL_DOCUMENTATION.md · LEAD_WORKSHEET_CODE_WALKTHROUGH.md · LEAD_WORKSHEET_API_DOCUMENTATION.md*
