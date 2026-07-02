# QUOTATION — COMBINED DOCUMENTATION

> Cross_Border_Command SaaS ERP · Sales Matrix → Stage 5 (Quotation vs PI) → **Quotation**
> **Single-file KT** — Functional · Technical · API · Code-Walkthrough in one document.
> Base URL: `{APP_URL}/api` · All endpoints require `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-02 | System | Initial combined documentation |

**Scope:** the **Quotation** entity created in **Stage 5** of the opportunity pipeline. The Quotation is the priced offer sent to a customer; it can be **converted into a Proforma Invoice** (see sibling `PROFORMA_INVOICE.md`). The 6-stage shell that hosts it is documented in `../matrix-stages/`.

---

# PART A — FUNCTIONAL

## A1. What a Quotation is
A **Quotation** (`QT/FY/SEQ`, e.g. `QT/2026-27/12`) is a priced offer built from a lead's mapped products. It captures the buyer (**Customer** + optional **Consignee**), banking, currency, shipping terms, and a set of **line items** (product, qty, rate, tax) whose amounts are **computed server-side**. Each quotation has a **version** (bumped on every edit) and moves through a **status lifecycle**. When accepted it is **converted to a Proforma Invoice**, copying its fields and lines.

**Two document types:**
- **International** — requires the shipping block: Inco Term, Port of Loading, Port of Discharge, Final Destination, Origin Country.
- **Domestic** — requires **State Code** instead of the shipping block.

## A2. Business value
| Benefit | Description |
|---|---|
| Fast, consistent offers | Line math, codes, and totals are system-generated — no manual arithmetic |
| Audit-grade numbering | `QT/FY/SEQ` is per-client, financial-year, gap-free, row-locked |
| Version history | Every edit bumps `version`; the offer's evolution is traceable |
| Safe conversion | A quotation converts to a PI carrying its exact lines + a back-reference |
| Deliverable | Quotation PDF is emailed via a 60-day signed link and can be e-signed (Zoho) |
| Tenant + branch isolation | Every row scoped by `client_id`/`branch_id` + sales visibility |

## A3. Status lifecycle
```
draft ──► sent ──► approved ──► converted_to_pi (terminal)
   └──────────┴──────────┴──────────► cancelled (terminal)
```
- Only **forward** transitions are allowed; `converted_to_pi` and `cancelled` are terminal.
- **Edit is blocked** once a quotation is `converted_to_pi` **or has been sent for e-signature** (409).
- **Cancel (delete)** is blocked once `converted_to_pi` (409). Cancelling sets `status = cancelled` (soft) — the row is kept for audit and hidden from the default list.

## A4. Where it lives in the UI
Stage 5 of the Matrix Detail (`Stage5QuotationVsPI.tsx`) — the **Quotation** tab of the segmented toggle. The **Create Quotation** button greys out once a PI exists on the opportunity (you can't add new quotations against an existing PI). Rows show: Sr · Quotation No (→ edit) · Date · Doc Type · Currency · Value · Action (**Convert to PI**; terminal chips *Converted to PI* / *Cancelled*). The create wizard is pre-fed the lead's already-mapped customer & consignee.

## A5. Business rules
| # | Rule | Behaviour |
|---|---|---|
| 1 | Code | `QT/FY/SEQ`, per-client, financial-year; **row lock + advisory lock**; gap-filling; unique `(client_id, code)` |
| 2 | Server-side totals | Line `amount = qty × rate × (1 + tax%/100)`; header `sub_total`/`grand_total` recomputed from **unrounded** lines then rounded once (avoids rounding drift). Client math is discarded |
| 3 | Snapshots | `product_name`/`hsn_code` snapshotted per line; `customer_name`/`consignee_name`/`opp_code`/`bank_label`/`sales_manager_name` cached on the header |
| 4 | Edit lock | Blocked if `converted_to_pi` or signed; editing supersedes any in-flight e-signature and bumps `version` |
| 5 | Wholesale item replace | On edit, all items are deleted and re-inserted with fresh `line_no` |
| 6 | Convert to PI | `convert-to-pi` only **marks intent** (`status=converted_to_pi`); the real PI is built by `POST /proforma-invoices/from-quotation/{id}` |
| 7 | Segment guard | Blocks quoting a product whose segment disallows the chosen consignee party (Buyer ≠ Consignee rules) |
| 8 | Soft cancel | `DELETE` sets `cancelled`; default list excludes it (pass `?status=cancelled` to see) |

---

# PART B — TECHNICAL

## B1. Architecture
```
React Stage5QuotationVsPI.tsx ──► /sales/quotations (+ /preview-code, /{id}, /duplicate, /convert-to-pi)
                                   QuotationController (auth:sanctum · user.active · SalesVisibility)
                                     ├─ Quotation ─ hasMany QuotationItem
                                     └─ nextCode(): clients row-lock + pg_advisory_xact_lock
PDF/email/e-sign ──► SalesPdfController (preview/email/remind/view) · ClmSignatureRequest (Zoho)
```

## B2. Database — `quotations`
*Migration `2026_05_30_000010`* (inco_term widened `2026_06_01_000100`)

Key columns: `id` · `client_id` (FK) · `branch_id` · **`code`** (unique `(client_id, code)`) · `version` · `doc_type` (International/Domestic) · `opp_id`/`opp_code`/`opportunity_date` · `customer_id`/`customer_name` · `consignee_id`/`consignee_name` · `bank_account_id`/`bank_label` · `currency`/`exchange_rate(12,4)` · `inco_term`/`port_of_loading`/`port_of_discharge`/`final_destination`/`origin_country` · `state_code` · `sales_manager_id`/`sales_manager_name` · `sub_total`/`shipping`/`grand_total` (decimal 14,2) · `status` · `emailed_at`/`last_reminded_at`/`reminder_count` · `terms` (≤8000) · `created_by`/`updated_by`.

**Indexes:** unique `(client_id, code)`; `(client_id, status)`, `(client_id, customer_id)`, `(client_id, opp_id)`, `(client_id, doc_type)`.

## B3. Database — `quotation_items`
*Migration `2026_05_30_000020`* — `id` · `quotation_id` (cascade) · `product_id` (nullable soft ref) · `product_name` (snapshot) · `hsn_code` · `quantity(14,4, ≥0.01)` · `unit` · `rate(14,4)` · `tax_pct(6,2)` · **`amount(14,2)`** (server-computed) · `line_no`. Index `(quotation_id, line_no)`.

## B4. Models
- **Quotation** — constants `STATUS_DRAFT/SENT/APPROVED/CONVERTED_TO_PI/CANCELLED`; casts totals decimal:2, `exchange_rate` decimal:4, `emailed_at`/`last_reminded_at` datetime. Relations: `items()` (ordered `line_no,id`), `branch`/`customer`/`consignee`/`lead`(opp_id)/`salesManager`/`creator`. Scopes `forClient()`, `active()`. `recomputeTotals()` helper.
- **QuotationItem** — casts qty/rate decimal:4, tax decimal:2, amount decimal:2; `computeAmount($qty,$rate,$tax) = round($qty*$rate*(1+$tax/100), 2)` — the single source of truth for line math.

## B5. Concurrency — code allocation (`nextCode`)
1. Caller row-locks the tenant's `clients` row (`lockForUpdate`).
2. `pg_advisory_xact_lock(crc32("qt-code:{client}:{fy}"))` (PostgreSQL) — serializes allocation even if a caller forgets the outer lock.
3. Scan existing `QT/{FY}/%`, take max SEQ, increment past gaps → `QT/{FY}/{n}`.
`currentFinancialYear()` — FY runs Apr 1–Mar 31; `Jan–Mar` → `(year-1)-year`, else `year-(year+1)`, formatted `YYYY-YY` (e.g. `2026-27`).

## B6. Access model
`applyScope()` — super-admin sees all (optionally `?branch_id`); branch users are pinned to their branch; client admins see all branches (honoring the switcher `branch_id`); all non-super users are `client_id`-scoped; `SalesVisibility::applyToSalesDocs()` layers role tier. `assertScope()` guards single-row read/write (404 out of scope). `userCanModify()` produces the `can_modify` UI flag.

---

# PART C — API

**Routes** (`routes/api.php`, under `auth:sanctum` + `user.active`):
```
GET    /sales/quotations                     index
GET    /sales/quotations/preview-code        previewCode
POST   /sales/quotations                     store
GET    /sales/quotations/{id}                show
PUT    /sales/quotations/{id}                update
DELETE /sales/quotations/{id}                destroy         (soft-cancel)
POST   /sales/quotations/{id}/duplicate      duplicate
POST   /sales/quotations/{id}/convert-to-pi  convertToPi     (marks intent)
POST   /sales/quotations/{id}/preview-pdf    SalesPdf@previewQuotation
POST   /sales/quotations/{id}/email          SalesPdf@emailQuotation
POST   /sales/quotations/{id}/remind         SalesPdf@remindQuotation
GET    /sales/quotations/{id}/view           SalesPdf@publicViewQuotation  (public, signed, 60-day)
```

### C1. `GET /sales/quotations`
Params: `page` (1), `per_page` (25, 1–200), `branch_id`, `status`, `doc_type`, `customer_id`, `opp_id`, `search`, `start_date`, `end_date`. Default list **excludes cancelled** (pass `?status=cancelled` to see them). Each row carries `can_modify`, `creator_name`, `creator_user_type`.
```json
{ "status": true,
  "data": [ { "id":1, "code":"QT/2026-27/1", "status":"draft", "grand_total":"12500.00",
              "currency":"USD", "customer_name":"Acme Corp", "can_modify":true } ],
  "pagination": { "current_page":1, "last_page":5, "per_page":25, "total":100 } }
```

### C2. `POST /sales/quotations`
Body (common): `doc_type*` · `opp_id` · `customer_id*` · `consignee_id` · `bank_account_id` · `currency` · `exchange_rate` · `sales_manager_id` · `shipping` · `terms(≤8000)` · `status` · `items[]*`. Item: `product_id` · `product_name*(≤255)` · `hsn_code` · `quantity*(≥0.01)` · `unit` · `rate*(>0)` · `tax_pct`.
Conditional: **International** → `inco_term*`,`port_of_loading*`,`port_of_discharge*`,`final_destination*`,`origin_country*`; **Domestic** → `state_code*`.
Server allocates the code, computes line `amount` + header totals, caches labels. **201** →
```json
{ "status": true, "code": 201,
  "data": { "id":9, "code":"QT/2026-27/12", "version":1, "status":"draft", "grand_total":"12000.00",
    "items": [ { "product_name":"P-01 – Basmati Rice", "quantity":"10.0000", "rate":"1200.0000", "amount":"12000.00", "line_no":1 } ] } }
```

### C3. `GET /sales/quotations/{id}`
Full row + `items` + `customer`/`consignee`/`lead`/`salesManager`. **404** out of scope.

### C4. `PUT /sales/quotations/{id}`
Same payload as create. **409** if `converted_to_pi` or **signed**. Validates the status transition, recomputes totals, **replaces all items**, **bumps `version`**, and **supersedes** any in-flight e-signature. **200** → updated row.

### C5. `DELETE /sales/quotations/{id}`
Soft-cancel → `{ "status": true, "message": "Cancelled" }`. **409** if already `converted_to_pi`.

### C6. `POST /sales/quotations/{id}/duplicate`
Clone with a **fresh code**, `status=draft`, `version=1`, replicated items. **201** → clone.

### C7. `POST /sales/quotations/{id}/convert-to-pi`
Marks `status=converted_to_pi` (**intent only**). **409** if already converted/cancelled. The real PI is created via `POST /sales/proforma-invoices/from-quotation/{id}`.

### C8. `GET /sales/quotations/preview-code`
Advisory next code — **no allocation, no lock**: `{ "status": true, "data": { "code": "QT/2026-27/13" } }`.

### C9. PDF / email / signed view
`preview-pdf` (dompdf, cached, blob) · `email` (recipient resolved, **3/min** rate limit, stamps `emailed_at` once, 60-day signed link) · `remind` (**422** if never emailed; fresh PDF + fresh link; bumps `reminder_count`) · `view` (**public**, `signed` middleware, 60-day, inline PDF).

---

# PART D — CODE WALKTHROUGH

> Legend: `→` call · `⇒` return. Line numbers reference live source and may drift.

## D1. Create — `store()` (99)
`validatePayload()` (395, doc-type-conditional) → `segmentPartyBlockResponse()` (Buyer≠Consignee, 422 on violation) → **row-lock `clients`** + `nextCode($clientId)` (600) → `prepareItems()` (455, computes each `amount`) → `aggregateTotals()` (482, sums **unrounded** lines, rounds once → `sub_total`/`grand_total`) → `resolveCachedLabels()` (509, fills customer/consignee/opp/bank/manager names; injects lead salesperson as default manager) → `Quotation::create()` + one `QuotationItem::create()` per line (`line_no = i+1`) ⇒ **201** with `fresh(['items'])`.

## D2. Edit — `update()` (184)
Guard: `converted_to_pi` → 409; signed (`ClmSignatureRequest::hasSignedForDoc`) → 409. Re-validate + segment guard → validate the **status transition** graph → prepare items + totals → update row with **`version+1`** → **delete all items, re-insert** → `ClmSignatureRequest::supersedeForDoc()` (revert to Not Sent) ⇒ **200**.

## D3. Cancel — `destroy()` (306)
`assertScope(write)` → **409** if `converted_to_pi` → else `status=cancelled` ⇒ `{message:"Cancelled"}`. `applyFilters()` (742) hides cancelled unless `?status=cancelled`.

## D4. Duplicate — `duplicate()` (325)
Row-lock + `nextCode()` → `replicate()` (override code/status=draft/version=1/created_by) → replicate each item onto the new id ⇒ **201**.

## D5. Convert intent — `convertToPi()` (358)
`assertScope(write)` → 409 if converted/cancelled → `status=converted_to_pi` ⇒ message noting the real PI is created by the PI `from-quotation` route.

## D6. Helpers
`prepareItems()` → per-line `QuotationItem::computeAmount()`. `aggregateTotals()` → header totals from unrounded lines (rounding-drift guard). `nextCode()` → FY + advisory + gap-fill. `resolveCachedLabels()` → label snapshots (+ manager default). `applyScope`/`assertScope`/`userCanModify` → tenant/branch/role gating. `applyFilters()` → status/type/customer/opp/date/search (ilike).

## D7. Cross-cutting patterns
| Pattern | Where | Why |
|---|---|---|
| Dual-lock code | `nextCode` (row lock + advisory) | Race-free, gap-free `QT/FY/SEQ` |
| Server totals | `prepareItems`+`aggregateTotals` | Never trust client math; no rounding drift |
| Snapshots | items + cached header labels | History stable if masters change |
| Edit lock + version | `update()` | Protect sent/signed docs; audit evolution |
| Wholesale replace | `update()` items | Simple + correct for small line sets |
| Intent vs action | `convertToPi` vs PI `fromQuotation` | Conversion truth lives on the PI side |
| Soft cancel | `destroy()` | Preserve audit, hide by default |

## D8. Notes & caveats
- **DB is PostgreSQL** — advisory locks + regex code scans.
- **Currency has no length cap** in validation (free-form code).
- **`convert-to-pi` is a marker** — always create the PI via the PI `from-quotation` route.
- **PDF cache** keys on content + signature flag; template edits need a manual clear.

---

*Related: `PROFORMA_INVOICE.md` (the conversion target) · `LEAD_ACKNOWLEDGEMENT_MASTER.md` · `../matrix-stages/` (the Stage-5 shell) · `../lead-worksheet/`.*
