# LEAD WORKSHEET MODULE — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Sales Matrix → Lead Worksheet + Lead Distribution
> Base URL: `{APP_URL}/api` · All endpoints require `Authorization: Bearer <sanctum_token>`

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial API documentation |

---

## 1. CONVENTIONS

**What a Lead is** — an opportunity in the Sales Matrix (`opp_code` `OPP-####`), moving through 6 visible pipeline stages. Sender details are denormalized on the lead until a `customer_id`/`consignee_id` is linked. Tenant-scoped (`client_id`/`branch_id`) + role-scoped (`SalesVisibility`).

**Auth & access** — `auth:sanctum` + `user.active`. Reads pass `applyScope()` (tenant) + `SalesVisibility::applyToLeads()` (self/team/all); the Axios client injects `?branch_id` on GETs.

**Envelope** — mixed. `index` → `{ data[], counts{}, pagination{} }`; `assign`/`sync`/`summary` → `{ status, … }`; item ops → `{ status, data }`/`{ status, message }`.

**Status codes** — `200`/`201` success · `401` unauth · `403` inactive / not permitted / assign out-of-scope · `404` not found / out of scope · `422` validation.

---

## 2. ENDPOINT INDEX

| # | Method | Path | Purpose |
|---|---|---|---|
| 1 | GET | `/sales/leads` | List (tabs + filters + search + pagination) |
| 2 | POST | `/sales/leads` | Create manual lead |
| 3 | GET/PUT/DELETE | `/sales/leads/{id}` | Show / update (stage, flags, owner…) / soft-delete |
| 4 | POST | `/sales/leads/assign` | Assign N leads → one salesperson |
| 5 | POST | `/sales/leads/convert-to-qualified` | Disqualified → qualified |
| 6 | GET | `/sales/leads/salespeople` | Assignable salesperson roster |
| 7 | GET | `/sales/leads/salesperson-summary` | **Lead Distribution** KPIs + per-person counts |
| 8 | GET | `/sales/leads/filter-options` | Filter facet options |
| 9 | GET | `/sales/leads/sync/config` · POST `/sales/leads/sync` | IndiaMart availability · trigger |
| 10 | GET | `/sales/leads/{id}/activity` | Assignment/creation timeline |
| 11 | — | `/sales/leads/{id}/{task-manager\|acknowledgements\|whatsapp\|products\|shared-prices}` | Stage 1–4 data (see §7) |

> Literal paths (`/sync`, `/assign`, `/salespeople`, `/salesperson-summary`, `/filter-options`, `/convert-to-qualified`) are registered before `/{id}`.

---

## 3. LIST — GET `/sales/leads`
| Param | Notes |
|---|---|
| `status` | `qualified` / `disqualified` / `key_opportunity` / `all` (+ `deal_state=in_progress\|won` for Key Opp) |
| `search` | LOWER-LIKE across opp/sender/product/remark + salesperson + customer |
| `lead_stage_id[]` | 1–5 direct; **6** = has sent PI, **8** = has shipment order (signal queries) |
| `platform[]` · `query_type[]` · `sender_country_iso[]` · `customer_id[]` | multi → WHERE IN |
| `salesperson_id[]` · `assigned` | owner filter · `1`=assigned / `0`=unassigned (`salesperson_id NULL`) |
| `start_date` · `end_date` | on `query_time` (00:00:00 … 23:59:59) |
| `page` · `per_page` · `with_counts` · `branch_id` | pagination · tab counts · branch switcher |
| `lead_ack_complete` · `exclude_with_pi` | opportunity-picker gates (Stage-2/4 complete; hide leads that already have a PI) |

```json
{ "data": [ { "id":42, "oppId":"OPP-0042", "type":"Buy Leads", "date":"15/06/2026",
    "source":"Agrotech", "assigned":"John Smith", "customer":"Acme Corp", "phone":"…",
    "email":"…", "product":"Basmati Rice", "company":"…", "country":"US",
    "status":"qualified", "whatsappStatus":"connected", "leadStageId":3, "keyOpportunity":false } ],
  "counts": { "qualified":120, "disqualified":18, "all":138, "key_opportunity":7 },
  "pagination": { "current_page":1, "last_page":6, "per_page":25, "total":138 } }
```

## 4. CREATE / UPDATE / DELETE
**POST `/sales/leads`** (create manual lead, txn, logs `generated`): `sender_name*`, `sender_mobile/email/company/address/city/state/pincode/sender_country_iso/sender_country_name`, `customer_id`/`consignee_id`, `query_message` (≤10 000), `product_quantity`, `query_product_name`. Defaults Qualified + Stage 1; `opp_code` row-locked. → `201 { data }`.

**PUT `/sales/leads/{id}`** — update sender fields, `qualified`/`disqualified` (mutually exclusive → 422), `lead_stage_id` (1–6), `salesperson_id` (must exist, not soft-deleted), `key_opportunity`, `remark` (≤5 000), `price`, `lead_ack_reason_id` (must be active), `customer_id`/`consignee_id`, whatsapp fields. **Victory gate:** entering Stage 6 requires a non-cancelled, signed PI (else 422); `won_at` auto-set on entry, cleared on regression. → `200 { data }`.

**DELETE `/sales/leads/{id}`** — soft-delete. → `200 { message }`.

## 5. ASSIGN & DISTRIBUTION

**POST `/sales/leads/assign`** — body `{ "lead_ids": [1,2,3], "salesperson_id": 5 }`. Guards: sales hierarchy + Sales-department membership (403 if the target is outside); out-of-scope leads silently skipped.
```json
{ "status": true, "message": "Leads assigned", "new_assigned": 2, "reassigned": 1, "skipped_no_scope": 0 }
```

**GET `/sales/leads/salespeople`** — `[ { id, name, code:"SA-001", role, subtitle } ]` (Sales-department employees).

**GET `/sales/leads/salesperson-summary`** — the Lead Distribution read model:
```json
{ "status": true,
  "summary": { "total_sales_persons": 6, "total_leads": 138, "assigned_leads": 120, "unassigned_leads": 18 },
  "platforms": ["Offline","Agrotech","Purvee"],
  "data": [ { "salesperson_id":5, "salesperson_name":"John Smith", "salesperson_code":"EMP-005",
    "department":"Sales", "designation":"Executive", "primary_role":"…", "ancillary_role":"…",
    "reporting_manager":"…", "email":"…", "platform_counts": {"Agrotech":5,"Offline":2}, "total_assigned_leads":7 } ] }
```
Sorted heaviest-first. **`convert-to-qualified`** — `POST /sales/leads/convert-to-qualified { lead_ids[] }`.

## 6. FILTER OPTIONS & SYNC
**GET `/sales/leads/filter-options`**
```json
{ "status": true,
  "platforms": ["Offline","Agrotech","Purvee"], "query_types": ["Manual","Direct Enquiries"],
  "countries": [ {"value":"US","label":"United States"} ],
  "customers": [ {"value":"123","label":"Acme Corp","code":"CUST-001"} ],
  "stages": [ {"value":"1","label":"Inquiry Required"}, {"value":"2","label":"Lead Acknowledgement"},
              {"value":"3","label":"Product Sourcing"}, {"value":"4","label":"Price Shared"},
              {"value":"6","label":"Quotation vs PI"}, {"value":"8","label":"Victory"} ] }
```
**GET `/sales/leads/sync/config`** → `{ enabled, labels[] }`. **POST `/sales/leads/sync`** → `{ fetched, created, updated, disqualified, errors[] }` (IndiaMart; India excluded; dedupe by `(client_id, platform, unique_query_id)`).

## 7. STAGE DATA (per-lead, reached from the Matrix Detail)
| Method | Path | Stage |
|---|---|---|
| GET/POST | `/sales/leads/{id}/activity` | ownership timeline |
| POST/PUT | `/sales/leads/{id}/task-manager` | 1 — PDM contact (+ attachment) |
| GET/POST | `/sales/leads/{id}/acknowledgements` | 2 — reasons → set qualified/disqualified |
| POST/PUT | `/sales/leads/{id}/whatsapp` | WhatsApp status (+ screenshot) |
| GET/POST/PUT/DELETE | `/sales/leads/{id}/products[/{mapping}]` | 2–3 — product mapping (currency/qty/target_price) |
| PATCH | `/…/products/{mapping}/sourcing-status` · `/mark-sourced` | 3 — sourcing required/done |
| GET/POST | `/…/{mapping}/shared-prices` · `/sales/leads/{id}/shared-prices` | 4 — quoted prices |
| GET | `/sales/shared-prices/{id}/pdf?inline=` | 4 — quotation PDF (dompdf + barcode) |

## 8. ERRORS & FLOW
`422 { message, errors:{…} }` · `403 { message:"…not allowed…"|"…outside your team…" }` · `404 { message:"No query results…" }`
```
GET  /sales/leads/filter-options              # facet options
POST /sales/leads   ·  POST /sales/leads/sync # add manual · pull IndiaMart
GET  /sales/leads?status=qualified&…filters   # worksheet list
POST /sales/leads/assign                      # assign to salesperson
GET  /sales/leads/salesperson-summary         # Lead Distribution KPIs
PUT  /sales/leads/{id}                        # advance stage (Victory gated) · qualify
```

---

*Related documents: LEAD_WORKSHEET_TECHNICAL_DOCUMENTATION.md · LEAD_WORKSHEET_FUNCTIONAL_DOCUMENTATION.md · LEAD_WORKSHEET_CODE_WALKTHROUGH.md*
