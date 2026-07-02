# LEAD WORKSHEET MODULE — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · Sales Matrix → Lead Worksheet + Lead Distribution
> A guided, file-by-file trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial code walkthrough |

---

## 0. HOW TO READ THIS DOCUMENT

Follows the worksheet in execution order. Line numbers reference the live source and may drift; method names are stable. Legend: `→` a call · `⇒` a return.

Primary files:
- `app/Http/Controllers/Api/SalesLeadController.php` (~2200 lines)
- `app/Models/Lead.php` (+ LeadProduct, LeadProductSharedPrice, LeadAcknowledgement, LeadTaskManager, LeadAssignmentHistory)
- `app/Support/SalesVisibility.php` · `app/Support/LeadActivity.php` · `app/Services/IndiaMartLeadSyncService.php`
- `resources/js/pages/sales/opportunity-pipeline/*` (SPA)

> **Boundary:** the **worksheet** (list + toolbar) is `SalesLeadWorksheet.tsx`; the **6 stages** are `matrix/SalesMatrixDetail.tsx`. This doc covers the worksheet + its outside-stage actions; the stages are only reached by opening a row.

---

## 1. THE WORKSHEET LIST

### 1.1 Frontend: `SalesLeadWorksheet.tsx`
```tsx
// tabs (Qualified/Disqualified/All/Key Opportunity) + debounced search (250ms) + active filters
const load = async () => {
  const res = await api.get('/sales/leads', { params: {
    status: tab, deal_state, search, page, per_page: rpp, with_counts: 1, ...activeFilters } });
  setRows(res.data.data); setCounts(res.data.counts); setPagination(res.data.pagination);
};
```
Rows-per-page **auto-fits** the viewport height. Clicking a row → `openMatrixDetail(l)` → `navigate('/sales/matrix/{oppId}/stage/{stage}')` (opp id + stage are encrypted). The stages are **not** part of this file.

### 1.2 Backend: `SalesLeadController::index()` (56)
```php
$q = Lead::query();
$this->applyScope($q, $user, $request->integer('branch_id'));   // tenant
SalesVisibility::applyToLeads($q, $user);                        // role tier (self/team/all)
$this->applyListFilters($q, $request);                          // §4 below
// status tab: qualified (qualified∧¬disqualified) / disqualified / key_opportunity (+deal_state) / all
// with_counts → compute tab counters off the indexed (client_id, qualified, disqualified, id)
return response()->json(['data'=>…, 'counts'=>…, 'pagination'=>…]);
```

---

## 2. OUTSIDE-THE-STAGES TOOLBAR

Each toolbar button is a **list-level** action (never a stage):
```
Add New Lead      → AddNewLeadModal          → POST /sales/leads
Assign Leads      → AssignLeadsModal (filters)→ POST /sales/leads/assign
Lead Distribution → navigate /sales/lead-distribution (AssignedLeadsModal) → GET /sales/leads/salesperson-summary
Sync from IndiaMart→ POST /sales/leads/sync   (only if GET /sales/leads/sync/config .enabled)
Filter            → LeadFilterModal          → GET /sales/leads/filter-options
Export            → dropdown (All/Qualified/Disqualified/Key Opp) → GET /sales/leads paged 200/req → xlsx
```
Row actions: 👁 Details (`GET /sales/leads/{id}`), 🕑 Activity (`GET /sales/leads/{id}/activity`), assign icon (single), bulk select → Assign / Convert-to-Qualified.

---

## 3. CREATING A LEAD

### 3.1 `store()` (406)
```php
return DB::transaction(function () use ($request, $user) {
    $data = $request->validate([ 'sender_name'=>'required|max:255', 'query_message'=>'max:10000', … ]);
    $lead = Lead::create($data + [
        'client_id'=>…, 'branch_id'=>…, 'created_by'=>$user->id,
        'opp_code'=>$this->nextOppCode($clientId),   // row-locked OPP-####
        'platform'=>'Offline', 'query_type'=>'Manual',
        'lead_stage_id'=>1, 'qualified'=>true, 'disqualified'=>false,
    ]);
    LeadActivity::log($lead, 'generated', …);        // → lead_assignment_histories
    return response()->json(['data'=>$this->shapeLead($lead)], 201);
});
```

---

## 4. FILTERS — `applyListFilters()` (248)
```php
// simple IN filters
foreach (['platform','query_type','salesperson_id','sender_country_iso','customer_id'] as $col)
    if ($v = $request->input($col)) $q->whereIn($col, (array) $v);
if ($request->has('assigned'))                         // 1 → NOT NULL, 0 → NULL
    $request->boolean('assigned') ? $q->whereNotNull('salesperson_id') : $q->whereNull('salesperson_id');
if ($s=$request->input('start_date')) $q->where('query_time','>=',"$s 00:00:00");
if ($e=$request->input('end_date'))   $q->where('query_time','<=',"$e 23:59:59");

// lead_stage_id — 1..5 direct, 6/8 by SIGNAL sub-queries
$stages = (array) $request->input('lead_stage_id');
//  6 → EXISTS clm_signature_requests / proforma_invoices.emailed_at (not yet shipped)
//  8 → EXISTS shipment_orders
//  1..5 → whereIn('lead_stage_id', …)

// search — LOWER(col) LIKE %term% across ~25 lead columns + salesperson + customer
```
`filterOptions()` (2019) returns platforms / query_types / countries (ISO→name fallback) / customers (≤500) / the **6 visible stages** (1,2,3,4,6,8).

---

## 5. ASSIGNMENT — `assign()` (813)
```php
$data = $request->validate(['lead_ids'=>'required|array|min:1','lead_ids.*'=>'integer','salesperson_id'=>'required|integer|exists:users,id']);

$assignable = SalesVisibility::assignableUserIds($user);            // hierarchy (null = admin)
if ($assignable !== null && !in_array($target, $assignable)) abort(403);
if ($salesDept = SalesVisibility::salesDepartmentIds())             // Sales-department gate
    if (!in_array($target, SalesVisibility::salesDepartmentUserIds($user, $user->branch_id))) abort(403);

$leads = Lead::whereIn('id', $ids); $this->applyScope($leads, $user);   // cross-tenant ids skipped
foreach ($leads->get() as $lead) {
    if ($lead->salesperson_id === $target) continue;                // no-op
    $wasNull = is_null($lead->salesperson_id);
    LeadActivity::log($lead, $wasNull ? 'assigned' : 'reassigned', …);
}
Lead::whereIn('id', $touched)->update(['salesperson_id'=>$target]);
return response()->json(['status'=>true,'new_assigned'=>…, 'reassigned'=>…, 'skipped_no_scope'=>…]);
```

---

## 6. LEAD DISTRIBUTION — `salespersonSummary()` (1812)
```php
// pivot leads by (salesperson_id, platform); build per-person rows + header KPIs
$summary = [
  'total_leads'         => $scoped->count(),
  'assigned_leads'      => (clone $scoped)->whereNotNull('salesperson_id')->count(),
  'unassigned_leads'    => (clone $scoped)->whereNull('salesperson_id')->count(),
  'total_sales_persons' => $distinctSalespersonCount,
];
// data[]: salesperson meta (dept/designation/roles/manager) + platform_counts + total_assigned_leads
// sorted by total_assigned_leads DESC, name ASC
```
Frontend `AssignedLeadsModal.tsx` renders the 4 KPI cards (clickable → `LeadsKpiModal` with `{assigned:true|false|undefined}`) and the per-salesperson roster; **View Leads** → `/sales/leads_details?sp=…` (`SalesLeadsDetails.tsx`).

---

## 7. QUALIFICATION & STAGE TRANSITIONS — `update()` (573)
```php
if ($request->boolean('qualified') && $request->boolean('disqualified')) abort(422);   // mutually exclusive
// Victory gate: entering stage 6 needs a non-cancelled + signed PI
if ($newStage == 6 && $lead->lead_stage_id < 6 && !$this->hasSignedPi($lead)) abort(422);
$lead->update($data);
if ($newStage == 6 && !$lead->won_at) $lead->update(['won_at'=>now()]);   // stamp on Victory
if ($newStage < 6 && $lead->won_at)   $lead->update(['won_at'=>null]);    // clear on regression
```
Stage-2 `storeAcknowledgements()` (1725, txn) writes acknowledgement rows and flips `qualified`/`disqualified` from the latest reason. Stage-3/4 live in `lead_products` + `lead_product_shared_prices`.

---

## 8. INDIAMART SYNC — `IndiaMartLeadSyncService`
```php
// syncForClient(): loop config('lead_sync.indiamart.keys') → fetchAndStore(crmKey, platform, …)
// fetchAndStore(): GET IndiaMart CRM Listing v2 (7-day window) → validate CODE/STATUS →
//   per record: dedupe by (client_id, platform, unique_query_id);
//   qualified = isQualified(iso)  (QUALIFIED_ISO_CODES — India EXCLUDED);
//   stage 1; update existing OR create with opp_code + branch attribution.
// returns { fetched, created, updated, disqualified, errors }
```
`syncFromCrm()` (759) runs it after `checkSyncTenantGate()`; `syncConfig()` (790) gates the button.

---

## 9. THE MODEL LAYER
`Lead` (`app/Models/Lead.php`) — SoftDeletes; belongsTo `salesperson`(User)/`customer`/`consignee`/`ackReason`; hasOne `taskManager`; hasMany `acknowledgements`(latest) / `leadProducts`. Sender fields are denormalized columns; `won_at` is the Victory timestamp; `lead_stage_id` (1–8) drives the pipeline.

---

## 10. CROSS-CUTTING PATTERNS
| Pattern | Where | Why |
|---|---|---|
| Toolbar ≠ stages | `SalesLeadWorksheet` vs `matrix/SalesMatrixDetail` | List actions stay in the list; stages are per-opportunity |
| Row-locked code | `nextOppCode()` | Race-free `OPP-####` per client |
| Signal-based stage filter | `applyListFilters()` | Stages 6/8 derived from PI/shipment existence, not just `lead_stage_id` |
| Assign guards | `assign()` + `SalesVisibility` | Hierarchy + Sales-department enforcement server-side |
| Audit everything | `LeadActivity::log` → `lead_assignment_histories` | Full ownership timeline |
| Country qualification | `IndiaMartLeadSyncService` | Export-buyer focus (India excluded) |
| Tenant + tier scope | `applyScope` + `SalesVisibility::applyToLeads` | Isolation on every read |

---

## 11. NOTES & CAVEATS
- **DB is PostgreSQL** — LOWER-LIKE search; composite unique `(client_id, platform, unique_query_id)` for CRM dedupe.
- **Stages 6 & 8 filters are computed** from PI/signature and shipment-order existence — not a plain `lead_stage_id` match.
- **Victory is gated** — a lead can't reach Stage 6 without a signed PI; `won_at` auto-stamps/clears.
- **India excluded** from IndiaMart sync (qualified = exportable country).
- **`canDistribute` is currently open to all** — the real enforcement is the hierarchy + Sales-department guards inside `assign()`.
- **Sender fields are denormalized** on the lead until a customer is linked.

---

*Related documents: LEAD_WORKSHEET_TECHNICAL_DOCUMENTATION.md · LEAD_WORKSHEET_FUNCTIONAL_DOCUMENTATION.md · LEAD_WORKSHEET_API_DOCUMENTATION.md*
