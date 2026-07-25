# MASTER DATA MODULE — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Masters (schema-driven lookups)

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-25 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
The **Master Data** module is the single reference-data backbone of the ERP. Every business screen — Sales, CLM, Procurement, HR, Warehouse, Billing — draws its dropdowns, classifications and rule constants from here (countries, currencies, HSN codes, payment terms, departments, leave types, warehouse racks, and 50 more). One generic engine (`MasterController` + `MasterPage.tsx`) renders **56 masters** through the same list/add/edit/delete shell; only each master's *fields, columns and rules* differ. This keeps every lookup consistent, tenant-scoped, and searchable without a bespoke page per table.

### 1.2 Business value
| Benefit | Description |
|---|---|
| One consistent shell | All 56 masters share the same UI, validation feel, and permission model |
| Reference integrity | Downstream modules resolve names/rates/rules from a governed source |
| Multi-tenant isolation | Each client (and branch) keeps its own rows; globals are shared read-only |
| Duplicate protection | Case-insensitive uniqueness + system-seed locks stop shadow/dup rows |
| Auto-numbering | Codes like `DEPT-001`, `EXC-01`, `LE-0001` generated server-side per tenant |
| Fast dashboard | A single batch-count endpoint paints Active/Inactive pills for every card |

### 1.3 Key features
- **Schema-driven CRUD** — 56 masters served by one controller + one React page.
- **Category dashboard** — masters grouped into 10 business categories with live counts.
- **Rich per-field validation** — required, regex/pattern, enum options, numeric bounds, length caps, uppercase normalization.
- **Two uniqueness models** — composite (`uFields`) and independent-per-field (`uEach`), both case-insensitive on text, tenant-scoped.
- **System-seed protection** — globally-seeded rows (Retailer, Registered Office, Low/High risk, Standard/VIP…) are locked from edit/delete and can't be shadow-created.
- **Creator-hierarchy visibility** — who can see/edit/delete a row follows the tenant tier ladder.
- **Reference cascades** — dependent dropdowns (State off Country, Zone off Warehouse, GST off HSN).
- **Sublists & uploads** — Legal Entities carry inline bank accounts; Assets carry invoice/warranty files.

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | Every master, every tenant; may seed global rows (`client_id = NULL`) |
| Client Admin / Client User | Their client's rows + global rows; may narrow by branch via the switcher |
| Branch User | Globals + client-level rows + **own branch** rows (sibling branches hidden) |
| Employee | Globals + client-level rows + **only rows they created** (peer-isolated) |

Each master is an individually **permissioned module** (`master.<slug>`). A user needs an explicit `can_view / can_add / can_edit / can_delete` grant per master (super admins bypass). `organization_types` is a **super-admin-only** platform master.

---

## 3. BUSINESS PROCESS FLOW

```
┌───────────────────────────────────────────────────────────────────┐
│                       MASTER DATA LIFECYCLE                        │
└───────────────────────────────────────────────────────────────────┘
   MASTER DASHBOARD  →  10 category groups, each card shows Active/Inactive
        │                (one /master-counts batch call, permission-filtered)
        ▼
   OPEN A MASTER  (/masters/{slug})  → list, search, KPI strip
        │
        ├─ ADD  → form built from schema fields
        │      • required / pattern / enum / numeric-bounds checks
        │      • uppercase-normalize (ISO/IFSC/PAN…)
        │      • uniqueness: uFields (composite) OR uEach (per-field), case-insensitive
        │      • system-seed collision block
        │      • auto-code prefilled (DEPT-/EXC-/LE-) for configured masters
        │      • stamp client_id/branch_id from the logged-in user (never trusted from body)
        │      → CREATE + sync sublists (banks) + absorb uploads → bump form-bundle cache
        │
        ├─ EDIT → hierarchical gate (tier ladder) + is_system lock → UPDATE
        │
        └─ DELETE → hierarchical gate + is_system lock + in-use guards (GST) → soft delete
        │
        ▼
   DOWNSTREAM MODULES resolve names/rates/rules from these rows
   (Sales, CLM, Procurement, HR, Warehouse, Billing dropdowns & constants)
```

### 3.1 The 10 master categories (56 masters)
| Category | Masters |
|---|---|
| **Identity & Entity** (8) | Company Details · Legal Entities · Organization Types · Bank Accounts · Department Master · Roles · Designations · KPI Master |
| **Geography & Location** (6) | Countries · States · State Codes · Address Types · Ports of Loading · Ports of Discharge |
| **Trade & Commercial** (8) | Segments · HSN Codes · GST Percentages · Currencies · Units of Measurement · Packaging Materials · Product Conditions · Incoterms |
| **Party & Classification** (5) | Customer Consignee Type · Customer Classifications · Supplier Types · Supplier Behaviour · Applicable Parties |
| **Legal & Compliance** (5) | License Types · Risk Levels · Document Types · Hazard Classifications · Compliance Behaviours |
| **Operations & Support** (3) | Assets · Asset Categories · Expense Categories |
| **P2P Masters** (10) | Payment Terms · Approval Authority · Procurement Category · Sourcing Type · Override/Deviation Reason · Match Exception Type · Advance Payment Rules · Currency Exchange Rate Log · Goods vs Service Flag · Supplier Directory |
| **Warehouse Masters** (8) | Warehouse Master · Zone Master · Rack Type Master · Temperature Class Master · Rack & Location Master · Shelf/Level Master · Digital Twin · Freezer Management |
| **Attendance Master Management** (2) | Leave Type Master · Leave Plan Master |
| **Document & Evidence** (1) | Trigger Point Master |

### 3.2 Status model
Nearly every master carries a **`status`** (Active/Inactive; some use Superseded, Under Repair, Disposed, or warehouse states). The dashboard splits counts into Active vs Inactive; `status` is text and compared case-insensitively (`active/1/true/yes/enabled` = active).

---

## 4. MASTER CATALOGUE (each master, start to end)

> Columns: **Slug** (API key) · **Model → table** · **Key fields** · **Uniqueness** · **Notes**. Uniqueness `uEach` = each listed field independently unique (case-insensitive on text); `uFields` = the *combination* unique. All uniqueness is tenant-scoped.

### 4.1 Identity & Entity
| Master | Slug | Model → table | Key fields | Uniqueness | Notes |
|---|---|---|---|---|---|
| Company Details | `company` | Company → master_companies | company_name, short_code, gstin, pan, cin, iec, email, status | uEach: company_name, gstin, pan | GSTIN/PAN/CIN normalized UPPER |
| Legal Entities | `legal_entities` | LegalEntities → master_legal_entities | entity_name, legal_name, cin, incorporation date, business/sector, country/state, currency, status | uEach: entity_name, cin, legal_name | Auto `LE-0001`; inline **bank sublist** (≥1 required) |
| Organization Types | `organization_types` | OrganizationType → organization_types | name, status | — | **Super-admin only**; own controller `/organization-types` |
| Bank Accounts | `bank_accounts` | BankAccounts → master_bank_accounts | bank_name, account_holder, account_number, ifsc_code, swift_code, ad_code, is_primary, status | uFields: account_number+ifsc_code | Regex on account (9–18), IFSC, AD (14) |
| Department Master | `departments` | Departments → master_departments | name, code, parent_id, head, email, status | uEach: name, code | Auto `DEPT-001`; tenantScoped; self-ref parent |
| Roles | `roles` | Roles → master_roles | name, code, role_type, department_id, role_category, status | uFields: name | — |
| Designations | `designations` | Designations → master_designations | name, code, department_id, level, reports_to_id, status | uFields: name | Self-ref reports_to |
| KPI Master | `kpis` | Kpis → master_kpis | name, role_id, target_type, priority, status | uFields: name | Ref → roles |

### 4.2 Geography & Location
| Master | Slug | Model → table | Key fields | Uniqueness | Notes |
|---|---|---|---|---|---|
| Countries | `countries` | Countries → master_countries | name, iso_code, status | uEach: name, iso_code | ISO normalized UPPER |
| States | `states` | States → master_states | country_id, name, status | uFields: name+country_id | Cascade child of Country; large table |
| State Codes | `state_codes` | StateCodes → master_state_codes | state_id, state_code, status | uFields: state_id+state_code | List eager-loads state name |
| Address Types | `address_types` | AddressTypes → master_address_types | name, status | uEach: name | **lockedFixed** — Registered Office/Warehouse/Branch only; no add |
| Ports of Loading | `port_of_loading` | PortOfLoading → master_port_of_loadings | name, code, address, status | uEach: name, code | — |
| Ports of Discharge | `port_of_discharge` | PortOfDischarge → master_port_of_discharges | name, code, country_id, city, status | uEach: name, code | Ref → countries |

### 4.3 Trade & Commercial
| Master | Slug | Model → table | Key fields | Uniqueness | Notes |
|---|---|---|---|---|---|
| Segments | `segments` | Segments → master_segments | title, status | uFields: title | Drives CLM segment rules |
| HSN Codes | `hsn_codes` | HsnCodes → master_hsn_codes | hsn_code, description, gst_rate_id, status | uEach: hsn_code | Regex 4–10 digits; ref → gst_percentage |
| GST Percentages | `gst_percentage` | GstPercentage → master_gst_percentages | percentage, status | uFields: percentage | **Delete blocked when in use** by products/HSN |
| Currencies | `currencies` | Currencies → master_currencies | name, code, symbol, exchange_rate, status | uEach: name, code | — |
| Units of Measurement | `uom` | Uom → master_uoms | title, short_code, unit_type, status | uEach: title, short_code | Short code auto-derived from title |
| Packaging Materials | `packaging_material` | PackagingMaterial → master_packaging_materials | title, material_type, status | uEach: title | — |
| Product Conditions | `conditions` | Conditions → master_conditions | title, status | uFields: title | — |
| Incoterms | `incoterms` | Incoterms → master_incoterms | code, full_name, transport_mode, status | uEach: code, full_name | — |

### 4.4 Party & Classification
| Master | Slug | Model → table | Key fields | Uniqueness | Notes |
|---|---|---|---|---|---|
| Customer Consignee Type | `customer_types` | CustomerTypes → master_customer_types | name, gst_applicable, status | uEach: name | System seeds Retailer/Wholesaler (locked) |
| Customer Classifications | `customer_classifications` | CustomerClassifications → master_customer_classifications | name, credit_limit, payment_terms, status | uEach: name | System seeds Standard/VIP (locked) |
| Supplier Types | `vendor_types` | VendorTypes → master_vendor_types | name, description, status | uFields: name | — |
| Supplier Behaviour | `vendor_behaviour` | VendorBehaviour → master_vendor_behaviours | name, description, status | uFields: name | — |
| Applicable Parties | `applicable_types` | ApplicableTypes → master_applicable_types | name, party_type, status | uFields: name | — |

### 4.5 Legal & Compliance
| Master | Slug | Model → table | Key fields | Uniqueness | Notes |
|---|---|---|---|---|---|
| License Types | `license_name` | LicenseName → master_license_names | name, license_code, issuing_authority, validity_months, status | uEach: name, license_code | — |
| Risk Levels | `risk_levels` | RiskLevels → master_risk_levels | name, description, action_required, status | uEach: name | System seeds Low/High (locked) |
| Document Types | `document_type` | DocumentType → master_document_types | title, applicable_to, is_mandatory, status | uFields: title | — |
| Hazard Classifications | `haz_class` | HazClass → master_haz_classes | name, status | uFields: name | — |
| Compliance Behaviours | `compliance_behaviours` | ComplianceBehaviours → master_compliance_behaviours | name, action_required, status | uFields: name | — |

### 4.6 Operations & Support
| Master | Slug | Model → table | Key fields | Uniqueness | Notes |
|---|---|---|---|---|---|
| Assets | `assets` | Assets → master_assets | asset_name, code, asset_type_id, vendor_id, purchase/warranty dates, status | uEach: asset_name, code | **File uploads** (invoice/warranty); refs → asset_categories, vendor_directory |
| Asset Categories | `asset_categories` | AssetCategories → master_asset_categories | name, depreciation_rate, useful_life_years, status | uFields: name | System rows locked from delete (used by onboarding) |
| Expense Categories | `expense_category` | ExpenseCategories → master_expense_categories | code, name, monthly/yearly limit, status | uEach: code, name | Auto `EXC-01`; tenantScoped |

### 4.7 P2P Masters
| Master | Slug | Model → table | Key fields | Uniqueness | Notes |
|---|---|---|---|---|---|
| Payment Terms | `payment_terms` | PaymentTerms → master_payment_terms | term_code, term_name, credit_days, advance_pct, payment_type, status | uEach: term_code, term_name | — |
| Approval Authority | `approval_authority` | ApprovalAuthority → master_approval_authorities | role_name, module_scope, min/max value, currency, status | uFields: role_name+module_scope | — |
| Procurement Category | `procurement_category` | ProcurementCategory → master_procurement_categories | cat_code, cat_name, match_logic, grn_required, gst_applicable, status | uEach: cat_code, cat_name | — |
| Sourcing Type | `sourcing_type` | SourcingType → master_sourcing_types | type_code, type_name, quotation_required, approval_required, status | uEach: type_code, type_name | — |
| Deviation Reason | `deviation_reason` | DeviationReason → master_deviation_reasons | reason_code, reason_name, module, attachment/approval flags, status | uEach: reason_code, reason_name | — |
| Match Exception Type | `match_exception` | MatchException → master_match_exceptions | exc_code, exc_name, tolerance_pct(0-100), blocks_payment, resolver_role, status | uEach: exc_code, exc_name | — |
| Advance Payment Rules | `advance_payment_rules` | AdvancePaymentRules → master_advance_payment_rules | vendor_type, procurement_cat, max_advance_pct(0-100), approver_role, status | uFields: vendor_type+procurement_cat | — |
| Currency Exchange Rate Log | `exchange_rate_log` | ExchangeRateLog → master_exchange_rate_logs | currency_code, rate_vs_inr, effective_date, rate_source, status | uFields: currency_code+effective_date | status Active/Superseded |
| Goods vs Service Flag | `goods_service_flag` | GoodsServiceFlag → master_goods_service_flags | flag_code, flag_name, grn_screen, evidence_type, status | uEach: flag_code, flag_name | — |
| Supplier Directory | `vendor_directory` | VendorDirectory → master_vendor_directories | vendor_company_name, contact_person, mobile, email, segment_id, address, country/state/city, status | uEach: vendor_company_name, mobile_number, email_id | Ref → segments, states |

### 4.8 Warehouse Masters
| Master | Slug | Model → table | Key fields | Uniqueness | Notes |
|---|---|---|---|---|---|
| Warehouse Master | `warehouse_master` | WarehouseMaster → master_warehouses | wh_id, wh_name, wh_type, city, area_sqft, status | uEach: wh_id, wh_name | — |
| Zone Master | `zone_master` | ZoneMaster → master_zones | zone_id, zone_name, zone_type, warehouse, cold_chain, hazardous, status | uEach: zone_id, zone_name | Ref → warehouse_master |
| Rack Type Master | `rack_type_master` | RackTypeMaster → master_rack_types | type_code, type_name, suitable_for, max_load, status | uEach: type_code, type_name | — |
| Temperature Class Master | `temp_class_master` | TempClassMaster → master_temp_classes | class_code, class_name, temp range, monitoring, status | uEach: class_code, class_name | — |
| Rack & Location Master | `racks` | Racks → master_racks | warehouse, zone, rackName, rackType, rackStatus, tempClass, shelves | uFields: rackName | Refs → warehouse/zone/rack_type/temp_class |
| Shelf / Level Master | `shelf_master` | ShelfMaster → master_shelves | rack_ref, shelf_name, level_no, shelf_type, max_weight, status | uFields: shelf_name | Ref → racks |
| Digital Twin | `digital_twin` | DigitalTwin → master_digital_twins | name, status | uFields: name | — |
| Freezer Management | `freezers` | Freezers → master_freezers | name, warehouse, capacity, status | uFields: name+warehouse | Ref → warehouse_master |

### 4.9 Attendance Master Management
| Master | Slug | Model → table | Key fields | Uniqueness | Notes |
|---|---|---|---|---|---|
| Leave Type Master | `leave_type` | LeaveTypes → master_leave_types | name, type, short_code, is_sick_medical, paid_unpaid, gender_restriction, status | uEach: name, short_code | tenantScoped; short_code UPPER + regex; feeds HR Leave |
| Leave Plan Master | `leave_plan` | LeavePlans → master_leave_plans | plan_name, from_month_type, from_month, calendar_year, is_default, status | uFields: plan_name | tenantScoped; drives Leave Plans |

### 4.10 Document & Evidence
| Master | Slug | Model → table | Key fields | Uniqueness | Notes |
|---|---|---|---|---|---|
| Trigger Point Master | `trigger_point` | TriggerPoints → master_trigger_points | module_name, description, status | uFields: module_name | tenantScoped |

---

## 5. SCREEN SPECIFICATIONS

### 5.1 Master Dashboard (`MasterDashboard.tsx`)
Cards grouped by the 10 categories. Each card shows the master's icon, title, and **Active / Inactive** pills fed by a single `/master-counts` batch call (permission-filtered — a card the user can't view shows 0/0 rather than hanging). Clicking a card routes to `/masters/{slug}`.

### 5.2 Generic Master Page (`MasterPage.tsx`)
```
┌───────────────────────────────────────────────────────────────────┐
│  <Master Title>            [optional KPI strip]     [+ Add]        │
│  [Search]                          (per-master filters: dept/role) │
│  ┌ data table (columns from cfg.cols) ───────────────────────────┐│
│  │ row … status pill … Created By … [Edit] [Delete]              ││
│  └───────────────────────────────────────────────────────────────┘│
└───────────────────────────────────────────────────────────────────┘
```
- **Add/Edit modal** — fields rendered from `cfg.fields`: text, number, email, date, textarea, select (static opts or `ref` dropdown from another master), radio, file, and **sublist** cards (banks). Auto-code fields fetch `/master/{slug}/next-code` on open. Cascading dropdowns filter by a parent field (State off Country).
- **Delete** — confirm dialog; blocked with a message for system rows / in-use GST rates / cross-tier rows.
- **"How this works"** (`wtd`) — a short step strip explaining the master.

---

## 6. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | Every master is separately permissioned as `master.<slug>` (view/add/edit/delete) |
| 2 | `client_id` / `branch_id` are stamped from the authenticated user, never trusted from the body |
| 3 | Uniqueness is tenant-scoped and case-insensitive on text; `uEach` = per-field, `uFields` = combination |
| 4 | System-seeded rows (`is_system`) can't be edited, deleted, or shadow-created by name |
| 5 | Edit/delete follows the tier ladder (super > client > branch); creators always manage their own rows; employees are peer-isolated |
| 6 | Address Types is a fixed vocabulary — no new rows (UI + API) |
| 7 | A GST rate referenced by any product or HSN code cannot be deleted |
| 8 | Auto-codes (DEPT-/EXC-/LE-) are generated server-side per tenant scope |
| 9 | Uploaded files (`*_file`) are stored under `master/{slug}` and the path saved to `*_file_path` |
| 10 | Any create/edit/delete bumps the form-bundle cache so dropdowns refresh immediately |
| 11 | `organization_types` is super-admin-only (own controller, but counted on the dashboard) |
| 12 | Deletes are soft (`deleted_at`) on masters that use SoftDeletes |

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Permissions | Enforced per-master via `master.<slug>`; there is no bulk "all masters" grant |
| Search | Server-side `ILIKE` across text-type fields only (not numeric/date columns) |
| Bulk ops | No bulk import/export or bulk status toggle in the generic page |
| Referential deletes | Only GST has an explicit in-use guard; other referenced masters rely on tier/system locks |
| Cache freshness | Dropdown bundles are refreshed by a version bump, not per-key eviction |

---

*Related documents: MASTER_TECHNICAL_DOCUMENTATION.md · MASTER_CODE_WALKTHROUGH.md · MASTER_API_DOCUMENTATION.md*
