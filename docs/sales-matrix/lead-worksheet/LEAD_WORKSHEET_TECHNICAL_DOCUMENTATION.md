# LEAD WORKSHEET MODULE — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Sales Matrix → Lead Worksheet + Lead Distribution

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
The **Lead Worksheet** is the list-view + workspace over the `leads` table. A single `SalesLeadController` (~2200 lines) backs the worksheet, the outside-stage actions (create / assign / distribute / filter / sync / export) **and** the 6-stage pipeline data (task manager, acknowledgements, products, shared prices). The worksheet UI (`SalesLeadWorksheet.tsx`) is separate from the per-opportunity **Matrix Detail** (`matrix/SalesMatrixDetail.tsx`); the boundary is: *toolbar/list = worksheet*, *stages = matrix*.

### 1.2 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     LEAD WORKSHEET (Sales Matrix)                    │
│  resources/js/pages/sales/opportunity-pipeline/                      │
│  ┌────────────────────┐  ┌──────────────────────────────────────┐  │
│  │ SalesLeadWorksheet │  │ Outside-stage modals:                 │  │
│  │ (list + toolbar)   │  │  AddNewLead · AssignLeads ·           │  │
│  └────────────────────┘  │  AssignedLeads (Lead Distribution) ·  │  │
│  ┌────────────────────┐  │  LeadFilter · LeadsKpi · LeadActivity │  │
│  │ SalesLeadsDetails  │  └──────────────────────────────────────┘  │
│  └────────────────────┘  matrix/SalesMatrixDetail = the 6 stages    │
└─────────────────────────────────────────────────────────────────────┘
                                   │  HTTPS / JSON (+?branch_id on GET)
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│           Laravel 12 API · auth:sanctum → user.active                │
│  SalesLeadController  (list/filter · CRUD · assign · summary ·       │
│    salespeople · filterOptions · syncConfig/syncFromCrm · activity · │
│    task-manager · acknowledgements · products · shared-prices)       │
│  Support: SalesVisibility (tier scope + assignable) · LeadActivity   │
│  Services: IndiaMartLeadSyncService                                  │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ Lead ─┬─ belongsTo User(salesperson) · Customer · Consignee    │ │
│  │       ├─ hasOne LeadTaskManager (Stage 1)                      │ │
│  │       ├─ hasMany LeadAcknowledgement (Stage 2)                 │ │
│  │       └─ hasMany LeadProduct ─ hasMany LeadProductSharedPrice  │ │
│  │  lead_assignment_histories (audit)                            │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│      PostgreSQL (c_b_c)   ·   IndiaMart CRM API (inbound sync)        │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.3 Access model
- All `/sales/leads*` routes carry `auth:sanctum` + `user.active`.
- **`applyScope()`** — tenant scope by `client_id` (+ `branch_id`; branch users also see null-branch client-level leads).
- **`SalesVisibility::applyToLeads()`** — role tier narrowing (`self`/`team`/`all`); admins unnarrowed.
- Assignment additionally passes an **assignable-user** guard (hierarchy) + a **Sales-department** membership gate.

### 1.4 Module Structure

```
app/Http/Controllers/Api/SalesLeadController.php        # ~2200 lines, ~30 methods
app/Models/  Lead · LeadProduct · LeadProductSharedPrice · LeadAcknowledgement
             · LeadTaskManager · LeadAckReason · LeadAssignmentHistory
app/Support/ SalesVisibility.php · LeadActivity.php
app/Services/IndiaMartLeadSyncService.php

database/migrations/
  2026_05_18_000001_create_lead_ack_reasons_table.php
  2026_05_21_000010_create_leads_table.php
  2026_05_21_000030_create_lead_task_managers_table.php
  2026_05_21_000040_create_lead_acknowledgements_table.php
  2026_05_21_000050_create_lead_products_table.php
  2026_05_30_000050_add_sourcing_columns_to_lead_products_table.php
  2026_05_30_000090_create_lead_product_shared_prices_table.php
  2026_05_30_000100_add_won_at_to_leads_table.php
  2026_06_13_000001_create_lead_assignment_histories_table.php

resources/js/pages/sales/opportunity-pipeline/
  SalesLeadWorksheet.tsx · SalesLeadsDetails.tsx
  AddNewLeadModal · AssignLeadsModal · AssignedLeadsModal · LeadFilterModal
  LeadsKpiModal · LeadActivityModal · LeadDetailsModal · LeadEvidenceVaultModal
  ConvertToPiModal · EntityPickerModal · SigningTrackerModal
  matrix/SalesMatrixDetail + matrix/stages/Stage1..6   (the 6 stages — separate)
```

---

## 2. TECHNOLOGY STACK
PHP 8.2 / Laravel 12 / **PostgreSQL** / Sanctum 4 on the backend; React 19 + TS 6 + Vite 7 + reactstrap/Bootstrap/Tailwind + xlsx (export) + Axios on the frontend. PDFs via dompdf + barcode (Stage-4 quotation). Inbound leads via the IndiaMart CRM Listing v2 API.

---

## 3. DATABASE SCHEMA

### 3.1 ERD

```
┌───────────────────────┐  1  ►*  ┌──────────────────────┐  1  ►*  ┌────────────────────────────┐
│         users         │─────────│        leads         │─────────│       lead_products         │
│  (salesperson_id)     │ assign  ├──────────────────────┤ hasMany ├────────────────────────────┤
└───────────────────────┘         │ id · opp_code UNIQUE │         │ product_id · currency ·     │
┌───────────────────────┐  1  ►1  │ client_id/branch_id  │         │ quantity · target_price ·   │
│    lead_task_managers │◄────────│ platform/query_type  │         │ sourcing_status · proc_done │
└───────────────────────┘ hasOne  │ sender_* (denorm)    │         └───────────┬────────────────┘
┌───────────────────────┐  1  ►*  │ lead_stage_id 1..8   │              1  ►*  │ hasMany
│  lead_acknowledgements│◄────────│ qualified/disqual.   │         ┌───────────┴────────────────┐
└───────────────────────┘ hasMany │ key_opportunity/won_at│        │ lead_product_shared_prices  │
                                  │ has_whatsapp/status  │         │ quoted_price · shared_at    │
  customer_id → customers         │ salesperson_id (FK)  │         └────────────────────────────┘
  consignee_id → consignees       │ customer/consignee_id│
  lead_ack_reason_id → …reasons   │ deleted_at (softdel) │  ── audit ──► lead_assignment_histories
                                  └──────────────────────┘             (generated/assigned/reassigned)
```

### 3.2 Table: `leads`  *(SoftDeletes; migration `2026_05_21_000010`, `…000100`)*
Key columns: `id`, `client_id`/`branch_id` (tenant), **`opp_code`** (UNIQUE, `OPP-####`), `unique_query_id` (+ `platform` unique for CRM dedupe), `platform`/`query_type`/`source_account`/`query_time`, **sender_*** (name/mobile/email/company/address/city/state/pincode/country_iso/country_name + alts — denormalized), `query_product_name`/`query_message`/`product_quantity`/`query_mcat_name`, **`lead_stage_id`** (tinyint, default 1), `qualified`/`disqualified`/`key_opportunity` (bool), **`won_at`** (auto on Victory), `has_whatsapp`/`whatsapp_status`/`whatsapp_reason`/`whatsapp_screenshot`, **`salesperson_id`** (FK users), `customer_id`/`consignee_id`/`lead_ack_reason_id`, `remark`/`price`/`created_by`.

**Uniques:** `opp_code`; `(client_id, platform, unique_query_id)`. **Perf indexes:** `(client_id, qualified, disqualified[, id])`, `(client_id, salesperson_id)`, `(client_id, platform)`, `(client_id, query_time)`, `(client_id, lead_stage_id, created_at)`, `(client_id, sender_email)`, `(client_id, sender_company)`.

### 3.3 Related tables
| Table | Stage | Key columns | Notes |
|---|---|---|---|
| `lead_task_managers` | 1 | `lead_id` (**unique/tenant**), name/mobile/email, order_value, buying_plan, attachment | one PDM record per lead |
| `lead_acknowledgements` | 2 | `lead_id`, `lead_ack_reason_id`, `opportunity_type` (qualified/disqualified/clarity_pending), `dq_status`, `reason_snapshot` | activity log; latest sets flags |
| `lead_ack_reasons` | master | `client_id`, `opportunity_type`, `reason`, `status`, `dq_status` | qualification reasons |
| `lead_products` | 2–3 | `lead_id`+`product_id` (**unique pair**), currency, quantity, target_price, `sourcing_status` (required/not_required), `procurement_done` | one currency/lead |
| `lead_product_shared_prices` | 4 | `lead_id`, `lead_product_id`, `quoted_price`, `shared_at` | quotation history |
| `lead_assignment_histories` | audit | `lead_id`, `opp_code`, action, assignee/previous/by snapshots, platform/source | ownership timeline |

---

## 4. MODEL RELATIONSHIPS (`app/Models/Lead.php`)
```php
class Lead extends Model {
    use SoftDeletes;
    // casts: query_time/won_at datetime; qualified/disqualified/key_opportunity/has_whatsapp bool; lead_stage_id int
    public function client()/branch()/creator();
    public function salesperson()   { return $this->belongsTo(User::class, 'salesperson_id'); }
    public function customer()       { return $this->belongsTo(Customer::class); }
    public function consignee()      { return $this->belongsTo(Consignee::class); }
    public function ackReason()      { return $this->belongsTo(LeadAckReason::class, 'lead_ack_reason_id'); }
    public function taskManager()    { return $this->hasOne(LeadTaskManager::class); }
    public function acknowledgements(){ return $this->hasMany(LeadAcknowledgement::class)->latest('id'); }
    public function leadProducts()   { return $this->hasMany(LeadProduct::class); }
}
```

---

## 5. API ENDPOINTS (routes/api.php ~399–487)
```php
Route::get   ('/sales/leads',                       'index');
Route::post  ('/sales/leads',                       'store');
Route::get   ('/sales/leads/sync/config',           'syncConfig');
Route::post  ('/sales/leads/sync',                  'syncFromCrm');
Route::post  ('/sales/leads/assign',                'assign');
Route::post  ('/sales/leads/convert-to-qualified',  'convertToQualified');
Route::get   ('/sales/leads/salespeople',           'salespeople');
Route::get   ('/sales/leads/salesperson-summary',   'salespersonSummary');   // Lead Distribution KPIs
Route::get   ('/sales/leads/filter-options',        'filterOptions');
Route::get   ('/sales/leads/{id}',                  'show');   // + PUT update, DELETE destroy
Route::get   ('/sales/leads/{id}/activity',         'activity');
// stage data: /{id}/task-manager · /acknowledgements · /whatsapp · /products[/{mapping}[/…]] · /shared-prices
```
Full request/response detail in **LEAD_WORKSHEET_API_DOCUMENTATION.md**. Literal paths (`/sync`, `/assign`, `/salespeople`, `/filter-options`, …) are registered before `/{id}`.

---

## 6. CONTROLLER METHOD ANALYSIS (`SalesLeadController`)

| Method | Line | Purpose |
|---|---|---|
| `index` | 56 | List + tab counts; `applyListFilters()` + `applyScope()` + `SalesVisibility`; pagination + `with_counts` |
| `store` | 406 | Create manual lead (txn; logs `generated`); default Qualified/Stage 1; `nextOppCode()` row-lock |
| `show` / `update` / `destroy` | 488 / 573 / 743 | Detail · update (stage/flags/owner/whatsapp; Victory gate; `won_at` auto/clear) · soft-delete |
| `assign` | 813 | Bulk assign N leads → one salesperson; hierarchy + Sales-dept guards; logs assigned/reassigned |
| `convertToQualified` | 951 | Flip disqualified → qualified |
| `salespeople` | 1943 | Assignable Sales-department roster for the dropdown |
| `salespersonSummary` | 1812 | **Lead Distribution** — totals + per-salesperson platform counts |
| `filterOptions` | 2019 | platforms · query_types · countries · customers · stages (visible 6) |
| `syncConfig` / `syncFromCrm` | 790 / 759 | IndiaMart availability · trigger (`IndiaMartLeadSyncService`) |
| `activity` | 927 | Assignment/creation timeline |
| stage data | 995+ | `storeTaskManager`, `storeAcknowledgements`, `updateWhatsApp`, lead-products CRUD, shared-prices, quotation PDF |

Private helpers: `applyListFilters()` (248), `applyScope()` (2111), `nextOppCode()` (2198), `checkSyncTenantGate()`, `canDistribute()` (2236).

---

## 7. ASSIGNMENT & DISTRIBUTION

### 7.1 `assign()` (813)
Validates `lead_ids[]` + `salesperson_id`, then: (1) **hierarchy guard** `SalesVisibility::assignableUserIds()`; (2) **Sales-department gate** — if a "Sales" department exists, the target must be in it; (3) scope leads via `applyScope()` (cross-tenant ids silently skipped); (4) bulk `UPDATE salesperson_id`; (5) `LeadActivity::log()` per lead → **assigned** (was null) or **reassigned** (had a different owner). Returns `{ new_assigned, reassigned, skipped_no_scope }`.

### 7.2 `salespersonSummary()` (1812)
Aggregates leads pivoted by `(salesperson_id, platform)`; header KPIs `total_leads`, `assigned_leads` (`salesperson_id NOT NULL`), `unassigned_leads` (`NULL`), `total_sales_persons`; per-row `platform_counts` + `total_assigned_leads`, sorted heaviest-first. This is the Lead Distribution read model.

---

## 8. FILTERS
`applyListFilters()` honors: `platform[]`, `query_type[]`, `salesperson_id[]`, `assigned` (bool → NULL check), `sender_country_iso[]`, `customer_id[]`, `start_date`/`end_date` (on `query_time`), and a broad `search` (LOWER-LIKE across ~25 columns + related salesperson/customer). **`lead_stage_id`** is special: stages 1–5 map directly, but **stage 6** (Quotation/PI) and **stage 8** (Victory) are resolved by *signal* sub-queries (PI/signature rows, shipment orders). Tab status: `qualified` (qualified∧¬disqualified), `disqualified`, `key_opportunity` (+ `deal_state` in_progress/won). `filterOptions()` returns the option sets (stages limited to the visible 6).

---

## 9. INDIAMART SYNC (`IndiaMartLeadSyncService`)
`syncForClient()` loops the configured CRM keys (`config/lead_sync.php`); per key `fetchAndStore()` calls the IndiaMart CRM Listing v2 API (7-day lookback), validates the envelope (`CODE`/`STATUS`), then per record: **dedupe** by `(client_id, platform, unique_query_id)`, map `sender_*`, set **qualified = country is exportable** (`QUALIFIED_ISO_CODES` — **India excluded**), stage 1, and upsert (update existing / create with `opp_code` + branch attribution). Returns `{ fetched, created, updated, disqualified, errors }`. `syncConfig()`/`checkSyncTenantGate()` gate the button (branch pin in config).

---

## 10. ERROR HANDLING

| Condition | HTTP | Source |
|---|---|---|
| Not authenticated / inactive | 401 / 403 | sanctum / user.active |
| Assign target out of hierarchy or Sales dept | 403 | `assign()` guards |
| Lead not found / out of scope | 404 | binding + `applyScope` |
| Victory without signed PI · both qualified+disqualified | 422 | `update()` gates |
| Validation failure | 422 | `$request->validate()` |

`store`, `storeAcknowledgements`, `destroyLeadProduct` are transactional.

---

## 11. PERFORMANCE
Tab-count + list indexes on `(client_id, qualified, disqualified, id)` and `(client_id, lead_stage_id, created_at)`; sender email/company indexes for search; `opp_code` row-locked allocation; auto-fit pagination + `with_counts` gating on the client; export paged at 200/req; IndiaMart dedupe via the composite unique index.

---

## 12. CODE QUALITY METRICS
| Metric | Value |
|---|---|
| SalesLeadController LOC | ~2200 (~30 methods — worksheet + all 6 stages) |
| Lead tables | leads (+ task_managers, acknowledgements, ack_reasons, products, shared_prices, assignment_histories) |
| Services / support | IndiaMartLeadSyncService · SalesVisibility · LeadActivity |
| Frontend | SalesLeadWorksheet + SalesLeadsDetails + ~11 modals + matrix/ |
| FormRequest classes / tests | none (inline validation) |

---

*Related documents: LEAD_WORKSHEET_FUNCTIONAL_DOCUMENTATION.md · LEAD_WORKSHEET_CODE_WALKTHROUGH.md · LEAD_WORKSHEET_API_DOCUMENTATION.md*
