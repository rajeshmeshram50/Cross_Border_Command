# PROFORMA INVOICE — COMBINED DOCUMENTATION

> Cross_Border_Command SaaS ERP · Sales Matrix → **Proforma Invoice (PI)** (Stage 5 embedded + standalone `/sales/qpi`)
> **Single-file KT** — Functional · Technical · API · Code-Walkthrough in one document.
> Base URL: `{APP_URL}/api` · All endpoints require `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-02 | System | Initial combined documentation |

**Scope:** the **Proforma Invoice** entity — the binding priced document a customer signs before shipment. A PI is usually created by **converting a Quotation** (see sibling `QUOTATION.md`) but can also be built standalone. It is surfaced in **two UI places**: **inside Stage 5** (per-lead) and on the **standalone "Quotation Vs PI History" page** (`/sales/qpi`, tenant-wide, with With/Without-Shipment sub-tabs) — both covered here (§A4, §B7). The 6-stage shell is in `../My WorkPlace/matrix-stages/`.

---

# PART A — FUNCTIONAL

## A1. What a PI is
A **Proforma Invoice** (`PI/FY/SEQ`, e.g. `PI/2026-27/3`) is the priced document sent for customer sign-off. It mirrors the Quotation (buyer, banking, currency, shipping terms, line items with server-computed amounts) and adds:
- **`pi_type`** — **with_shipment** (allocates a Bank-Transfer ref **`BT-####`** + `bt_date`) or **without_shipment** (BT fields null).
- **`signing_mode`** — with_signature / without_signature.
- **Conversion provenance** — `source_quotation_id` + `convert_from_code` (the originating `QT/FY/SEQ`), shown as a **Converted From** badge.

**Two document types:** International (shipping block required) or Domestic (`state_code` required) — same rule as the Quotation.

## A2. Business value
| Benefit | Description |
|---|---|
| One binding doc per deal | Exactly **one non-cancelled PI per opportunity** — no conflicting invoices |
| Compliance-gated | Creation is blocked until mandatory KYC / DD / Trade-Licence docs are complete (DCP gate) |
| Faithful conversion | `from-quotation` copies every field + line and locks the currency to the quote |
| Auditable | FY-scoped `PI/FY/SEQ` + `BT-####`, version history, cached provenance |
| Signable delivery | Emailed via 60-day signed link; e-signed via Zoho; signed PIs unlock **Victory** |

## A3. Status lifecycle
```
draft ──► sent ──► approved ──► converted_to_contract (terminal)
   └──────────┴──────────┴──────────► cancelled (terminal)
```
- **Edit blocked** if `converted_to_contract` **or signed** (409 — "Duplicate it to make changes").
- **Cancel blocked** if `converted_to_contract` (409). Cancel sets `status=cancelled` (soft).
- **Currency locked** on from-quotation PIs — changing it → 422.

## A4. Where it lives in the UI — **two surfaces**
Like the Quotation, the PI appears in **two places** sharing one form + row actions:

1. **Inside Stage 5** (`Stage5QuotationVsPI.tsx`) — scoped to **one opportunity**. The **Proforma Invoice** tab; **Create PI** greys out if the deal is locked, a PI already exists (one-per-opp), or mandatory docs aren't 100% uploaded. The row shows **Converted From**, a **Status** e-sign pill (**Not Sent → Sent → Signed**, ~20 s sync) and per-row actions (Send for Signature, Remind, View/Download signed PDF + Certificate, Edit, Delete, Email). This surface drives **Save & Next** to Victory.
2. **The standalone "Quotation Vs PI History" page** (`/sales/qpi`, nav **`sales.quotation_vs_pi`**) — a **tenant-wide** list of **all** PIs across every lead, with **With Shipment / Without Shipment** sub-tabs. Same actions, no stage progression. Detailed in §B7.2.

> A PI sits in the **With-Shipment** bucket only once a real `SHP-###` shipment order exists (a Victory-stage deal or an auto-assigned legacy `bt_id` alone stays *Without Shipment*). Both surfaces are the same `SalesQPI` module.

**Opportunity is optional.** A PI can be built **from a quotation**, **from an opportunity**, or **standalone against a Customer with no opportunity** (`opp_id` = null; the one-PI-per-opp rule only bites when an `opp_id` is present). All create conditions are in §B7.3.

## A5. Business rules
| # | Rule | Behaviour |
|---|---|---|
| 1 | One PI per opportunity | A non-cancelled PI on the same `opp_id` blocks a second (**409** + `existing_pi`). Standalone PIs (no opp) are unlimited |
| 2 | DCP gate | Create/convert blocked if customer/consignee miss mandatory **KYC / DD / Trade-Licence** docs (**422**, lists what's pending). *(Categories `td`/`qc` are not gated.)* |
| 3 | Currency lock | From-quotation PIs are locked to the quote's currency (edit → **422**) |
| 4 | Codes | `PI/FY/SEQ` (scans `PI/` + legacy `INV/`) + `BT-####` (with_shipment only), both row-lock + advisory-lock allocated |
| 5 | BT clearing | Flipping to without_shipment nulls `bt_id`/`bt_date` on update |
| 6 | Server totals + snapshots | Same as Quotation — amounts recomputed; labels/lines snapshotted |
| 7 | Edit/delete locks | Blocked when signed or `converted_to_contract`; editing supersedes e-signature + bumps `version` |
| 8 | Soft cancel | `DELETE` → `cancelled`; default list excludes it |

## A6. Convert from Quotation (the primary path)
`POST /sales/proforma-invoices/from-quotation/{quotationId}` copies **all** quotation fields + line items, sets `source_quotation_id`/`convert_from_code`, always creates it **with_shipment** (allocating `BT-####`, `bt_date = today`), and marks the source quotation `converted_to_pi`. Gates run first: quotation not already converted/cancelled, one-PI-per-opp, DCP docs, segment (Buyer≠Consignee).

---

# PART B — TECHNICAL

## B1. Architecture
```
React Stage5QuotationVsPI.tsx ──► /sales/proforma-invoices (+ /from-quotation/{qtId}, /preview-code, /{id}, /duplicate)
                                   ProformaInvoiceController (auth:sanctum · user.active · SalesVisibility)
                                     ├─ ProformaInvoice ─ hasMany ProformaInvoiceItem
                                     ├─ sourceQuotation (belongsTo Quotation) · shipmentOrder (hasOne)
                                     └─ nextCode()/nextBtCode(): clients row-lock + pg_advisory_xact_lock
DCP gate ──► SegmentDocUploadController::missingMandatoryDocs()
PDF/email/e-sign ──► SalesPdfController · ClmSignatureRequest (Zoho)
```

## B2. Database — `proforma_invoices`
*Migration `2026_05_30_000030`*

Shares the Quotation columns (`code` unique `(client_id, code)`, `version`, `doc_type`, opp/customer/consignee refs + cached names, bank, currency/exchange, shipping block, sales manager, `sub_total`/`shipping`/`grand_total`, `status`, email/reminder, `terms`, audit) **plus**:
- `pi_type` (with_shipment/without_shipment, default with_shipment), `bt_id`, `bt_date`, `signing_mode`.
- `source_quotation_id` (FK→quotations, nullOnDelete) + `convert_from_code`.

**Indexes:** unique `(client_id, code)`; `(client_id, status)`, `(client_id, pi_type)`, `(client_id, customer_id)`, `(client_id, opp_id)`, `(client_id, source_quotation_id)`; plus `branch_id`, `bank_account_id`.

## B3. Database — `proforma_invoice_items`
*Migration `2026_05_30_000040`* — `id` · `proforma_invoice_id` (cascade) · `product_id` (nullable soft ref) · `product_name*` · `hsn_code` · `quantity(14,4)` · `unit` · `rate(14,4)` · `tax_pct(6,2)` · **`amount(14,2)`** (server-computed) · `line_no`. Index `pi_items_pi_line_idx (proforma_invoice_id, line_no)`.

## B4. Models
- **ProformaInvoice** — constants for statuses (`…CONVERTED_TO_CONTRACT`), types, sign modes, doc types. Casts: `bt_date`/`opportunity_date` date, `exchange_rate` decimal:4, totals decimal:2, email/remind datetime, `reminder_count` int. Relations: `items()`, `branch`, `customer`, `consignee`, `lead`(opp_id), **`shipmentOrder()`** (hasOne, provides `SHP-###`), **`sourceQuotation()`**, `salesManager`, `creator`. Scopes `forClient()`, `active()`.
- **ProformaInvoiceItem** — casts qty/rate decimal:4, tax decimal:2, amount decimal:2; `computeAmount($qty,$rate,$tax)` — single source of truth for line math.

## B5. Concurrency — code allocation
- `nextCode()` — row-lock `clients` + `pg_advisory_xact_lock(crc32("pi-code:{client}:{fy}"))`; scans `PI/{FY}/%` **and legacy `INV/{FY}/%`** → max SEQ, gap-fill → `PI/{FY}/{n}`.
- `nextBtCode()` — advisory lock `crc32("pi-bt:{client}")`; scans `BT-(\d+)` across the tenant → max+1 → `BT-####` (zero-padded, global per tenant, all branches share the BT sequence).
- `currentFinancialYear()` — Apr–Mar boundary, `YYYY-YY`.

## B6. Access model
Identical shape to the Quotation controller: `applyScope()` (super-admin all / branch pinned / client-admin all-branches + switcher), `SalesVisibility::applyToSalesDocs()`, `assertScope()` (404 out of scope), `assertQuotationScope()` (for `fromQuotation`), `userCanModify()` (→ `can_modify`).

## B7. Frontend architecture (SPA)
The PI UI shares the Quotation's list + form (`Stage5QuotationVsPI.tsx`, `SalesQPI.tsx`) and adds the **convert**, **e-sign** and **signed-lock** behaviours.

**Component tree (PI-specific)**
```
Stage5QuotationVsPI.tsx     the PI tab of the segmented toggle
  ├─ Create PI button — greyed if locked, a PI already exists, or mandatoryIncomplete (DCP)
  ├─ PI rows show: Converted-From · e-sign status pill · Email · Edit · MoreActions (Signed PDF/Certificate)
  ├─ fetchSignatures(sync) → GET /clm/signature-requests?lead_id=&document_type=proforma_invoice&sync=
  │     status map: 'inprogress'→Sent · 'completed'→Signed · none→Not Sent ; auto-poll every 20s
  └─ hosts:
       CreatePIModal (SalesQPI)                 — 2-step form + piType('with_shipment'|'without_shipment')
       ConvertToPiModal / ConversionBlockedModal — convert a quotation
       SalesDocSendForSignatureModal            — Zoho send (single buyer signer)
       SigningTrackerModal                       — signing progress

SalesQPI.tsx → CreatePIModal
  ├─ same 2-step form as the quotation, plus piType and source_quotation_id (when converted)
  └─ seeding: initialOpp (lead context) takes precedence over source (quotation carry-over)
```

**Create PI.** `POST /sales/proforma-invoices` (or `PUT /{id}`) with the quotation body **plus** `pi_type` and `source_quotation_id`. The **Create PI** button is disabled when the parent reports a live PI (one-per-opp) or `mandatoryIncomplete` (DCP KYC/DD/TL not 100%).

**Convert from quotation.** A quotation row's **Convert to PI** → checks for an existing live PI (else `ConversionBlockedModal` with a *View Existing PI* CTA) → fetches `GET /sales/proforma-invoices/preview-code` → opens **`ConvertToPiModal`** (shows From-Quotation, new PI code, PI date=today, quotation value; collects `pi_type`) → **`POST /sales/proforma-invoices/from-quotation/{qtId}`** → refresh, flip to the PI tab, and call `onPiChange()` to unlock the parent's CLM card.

**Send for signature (Zoho).** **`SalesDocSendForSignatureModal`** renders the PI PDF (`POST …/{id}/preview-pdf {signature:true}` via pdf.js), lets the user **drag/resize a single buyer signature box** (A4-point coords, per-page), set expiry (1–180 d) + notes, then **`POST /clm/signature-requests/sales-doc-send`** `{ doc_kind:'proforma_invoice', doc_id, lead_id, document_settings:{[id]:{buyer:{page,x,y,width,height}}}, expiry_days, notes }`. On success the parent re-polls with `sync=1`; the row pill flips **Not Sent → Sent → Signed**.

**Email.** `POST /sales/proforma-invoices/{id}/email` with a **per-row cooldown** (`emailCooldowns` keyed `pi:{id}`, `emailingRef` double-click mutex, optimistic `emailedAt` stamp); a **429** starts a 60 s (or `retry_after_seconds`) cooldown toast.

**Signed-lock / read-only.** When a PI is `completed` (or a PI `inprogress`), **Edit is blocked** (button greyed, toast on click); the parent-level `locked` prop disables all document creation. Advancing to Victory (`PUT /sales/leads/{id} lead_stage_id:6`) needs a live PI client-side; the server enforces the sent-for-signature gate.

**State/caching/validation** are shared with the Quotation form (master cache `useQpiMasters`, 5-min TTL; live client totals for preview only; Step-1 doc-type-conditional gate). See Quotation §B7.

### B7.1 Stage-5 view vs the standalone page
See **Quotation §B7.1** for the full comparison. In short: **Stage 5** is scoped to one `opp_id` and drives **Save & Next**; the standalone **`/sales/qpi`** page is **tenant-wide**, has no pipeline, and polls e-sign status across **all** documents.

### B7.2 The standalone "Quotation Vs PI History" page (`SalesQPI` default export)
Route **`/sales/qpi`** (nav **`sales.quotation_vs_pi`**) — the same page that lists quotations also lists **all PIs tenant-wide** (no `opp_id` filter), separate from the per-opportunity Stage-5 view.
- **PI tab + sub-tabs:** **With Shipment / Without Shipment** (`piSub`), derived from **`hasShipment`** (a real `shipment_code`/`SHP-###`) — a legacy `bt_id` or a Victory deal without a submitted shipment stays *Without*.
- **Data:** `GET /sales/proforma-invoices?per_page=200` on mount (spans every lead); each row also carries `convertFrom` (source quotation code), `btId` (**Shipp ID** = `shipment_code ?? bt_id`), `victoryReached`, `salesManager`, `branchName`, `createdBy`.
- **Columns (fuller than Stage 5):** Sr · PI No · PI Date · **Shipp ID** · **Converted From** · Opp ID/Date · Customer · Consignee · Doc Type · Currency · Sales Manager · Branch · **Created By** ("You" for self) · Actions.
- **Actions:** same as Stage 5 minus Save & Next — Create PI, **Convert to PI** (preview-code → `ConvertToPiModal`, blocked if the lead already has a PI), Email (cooldown + 429), Reminder (needs prior email), **Send for Signature / View Sent / Signed PDF / Certificate** with the **20 s all-docs** signature poll (`sync=1`, no lead filter), Edit (PUT).
- Its own auto-fit pager + search (PI No / Opp / Customer / Consignee / Converted-From / Shipp-ID). The read-only **Sign Tracker** page rides on the same `sales.quotation_vs_pi` permission.

> Difference from Stage 5: **scope is the whole tenant, there is no pipeline advance, and the e-sign poll covers every client document** (not one lead). Both surfaces call the same Part C endpoints.

### B7.3 Create conditions — opportunity optional (direct-customer path)
A PI can be created the same three ways, and **without** an opportunity:
- **From a quotation** — `Convert to PI` / the `from-quotation` path (the usual route; carries `source_quotation_id` + locks currency).
- **From an opportunity** — pick the lead; Customer/Consignee/currency auto-fill via the shared cascade.
- **Standalone (direct customer, no opp)** — pick a Customer directly; **`opp_id` is sent as `null`** (the backend allows unlimited standalone PIs — the one-per-opp rule only applies when an `opp_id` is present).

The **required-field gate, the opp↔customer↔consignee cascade, the locks, the `excludeWithPi` opp filter, and the consignee back-fill** are the **same shared form** — fully documented in **Quotation §B7.3**. PI-only differences: the create modal also carries **`pi_type`** (With/Without Shipment) and `lockParty` additionally locks when **editing**; the DCP mandatory-docs gate + one-PI-per-opp still apply on submit (Part A §A5).

---

# PART C — API

**Routes** (`routes/api.php`, under `auth:sanctum` + `user.active`):
```
GET    /sales/proforma-invoices                          index
GET    /sales/proforma-invoices/preview-code             previewCode
POST   /sales/proforma-invoices                          store
POST   /sales/proforma-invoices/from-quotation/{qtId}    fromQuotation   (primary path)
GET    /sales/proforma-invoices/{id}                     show
PUT    /sales/proforma-invoices/{id}                     update
DELETE /sales/proforma-invoices/{id}                     destroy          (soft-cancel)
POST   /sales/proforma-invoices/{id}/duplicate           duplicate
POST   /sales/proforma-invoices/{id}/preview-pdf         SalesPdf@previewProformaInvoice
POST   /sales/proforma-invoices/{id}/email               SalesPdf@emailProformaInvoice
POST   /sales/proforma-invoices/{id}/remind              SalesPdf@remindProformaInvoice
GET    /sales/proforma-invoices/{id}/view                SalesPdf@publicViewProformaInvoice (public, signed, 60-day)
```

### C1. `GET /sales/proforma-invoices`
Params: `page`, `per_page` (25, 1–200), `branch_id`, `status` (default excludes cancelled), `pi_type`, `doc_type`, `customer_id`, `opp_id`, `start_date`, `end_date`, `search` (ilike on code/bt_id/opp_code/customer_name/consignee_name/convert_from_code). Rows include `victory_reached` (`lead_stage_id ≥ 6` or `won_at`), `shipment_code`, `can_modify`, `creator_name`, eager `sourceQuotation`/`shipmentOrder`.

### C2. `POST /sales/proforma-invoices`
Body = Quotation body **plus** `pi_type`, `bt_id`, `bt_date`, `signing_mode`, `source_quotation_id`. Item qty rule `> 0.0001`. Gates in order: **DCP** (422), **segment** (422), **one-PI-per-opp** (409 + `existing_pi`). Allocates `PI/FY/SEQ` (+ `BT-####` if with_shipment), caches labels, marks the source quotation converted if `source_quotation_id` set. **201** → PI with `items`.

### C3. `POST /sales/proforma-invoices/from-quotation/{qtId}` — **core conversion**
Gates: quotation not converted/cancelled (409), one-PI-per-opp (409), DCP (422), segment (422). Copies all fields + items, `pi_type=with_shipment`, new `BT-####`, `bt_date=today`, `source_quotation_id`/`convert_from_code`, `status=draft`; marks the quotation `converted_to_pi`. **201** →
```json
{ "status": true, "data": { "id":4, "code":"PI/2026-27/3", "bt_id":"BT-0007",
   "source_quotation_id":12, "convert_from_code":"QT/2026-27/12", "status":"draft" } }
```

### C4. `GET /sales/proforma-invoices/{id}`
Full row + `items` + `customer`/`consignee`/`lead`/`sourceQuotation`/`salesManager`.

### C5. `PUT /sales/proforma-invoices/{id}`
**409** if `converted_to_contract` or **signed**. **422** if a from-quotation PI's **currency** is changed. Flipping to without_shipment nulls BT fields. Recomputes totals, **replaces items**, bumps `version`, supersedes e-signature. **200** → updated row.

### C6. `DELETE /sales/proforma-invoices/{id}`
Soft-cancel → `{ "status": true, "message": "Cancelled" }`. **409** if `converted_to_contract`.

### C7. `POST /sales/proforma-invoices/{id}/duplicate`
Clone: fresh `PI/FY/SEQ`, `status=draft`, `version=1`, replicated items. **201**.

### C8. `GET /sales/proforma-invoices/preview-code`
Advisory next `PI/FY/SEQ` (scans `PI/` + `INV/`), no lock: `{ "data": { "code": "PI/2026-27/4" } }`.

### C9. PDF / email / signed view
Same contract as Quotation — `preview-pdf` (cached blob), `email` (**3/min**, stamps `emailed_at`, 60-day signed link), `remind` (**422** if never emailed; fresh link; `reminder_count++`), `view` (**public**, `signed`, 60-day). A completed Zoho request stamps **`pi_signed_at`**, which makes the Matrix centre (Stages 3–5) **read-only**. *(Advancing to **Victory** itself only needs the PI **sent for signature or emailed** — not signed; the `SalesLeadController::update()` gate, see the worksheet/matrix-stages docs.)*

### C10. Error examples
```json
409 { "status":false, "message":"Opportunity OPP-2026-001 already has a PI: PI/2026-27/1. Only one PI is allowed per opportunity.",
      "existing_pi": { "id":1, "code":"PI/2026-27/1" } }
422 { "status":false, "message":"This Proforma Invoice can't be created yet — some required documents are still pending… Pending: Customer → Certificate of Incorporation, Trade License | Consignee → Due Diligence Report +1 more" }
422 { "status":false, "message":"This PI was created from a quotation and is locked to USD. Use a fresh PI to invoice in a different currency." }
409 { "status":false, "message":"This PI has already been signed and can no longer be edited. Duplicate it to make changes." }
```

---

# PART D — CODE WALKTHROUGH (backend)

> Legend: `→` call · `⇒` return. Line numbers reference live source and may drift. *(The SPA is documented in §B7 Frontend architecture.)*

## D1. Create — `store()`
`validatePayload()` (doc-type-conditional) → **DCP** `missingMandatoryDocs()` (422 if pending) → `segmentPartyBlockResponse()` (422) → **one-PI-per-opp** check on `opp_id` (409 + `existing_pi`) → txn: row-lock `clients`, `nextCode()` (+ `nextBtCode()` when with_shipment) → `resolveCachedLabels()` → `ProformaInvoice::create()` (defaults version 1 / pi_type with_shipment / status draft / manager = creator) → items (`line_no=i+1`) → if `source_quotation_id`, mark that quotation `converted_to_pi` ⇒ **201** `fresh(['items'])`.

## D2. Convert — `fromQuotation()`
`assertQuotationScope()` → quotation status gates (409 converted/cancelled) → one-PI-per-opp (409) → DCP (422) → segment (422) → txn: row-lock, `nextCode()` + `nextBtCode()`, **field-by-field copy** from the quotation (pi_type with_shipment, bt_date=today, `source_quotation_id`/`convert_from_code`, totals copied as-is), copy each line item, mark quotation `converted_to_pi` ⇒ **201**.

## D3. Edit — `update()`
Guard `converted_to_contract` → 409; signed (`hasSignedForDoc`) → 409. **Currency lock**: from-quotation PI + changed currency → 422. Resolve effective `pi_type`; if now without_shipment, null `bt_id`/`bt_date`. Update row (`version+1`), delete + recreate items, `supersedeForDoc()` (revert to Not Sent) ⇒ **200**.

## D4. Cancel / Duplicate / Preview
`destroy()` — 409 if `converted_to_contract` else `status=cancelled`. `duplicate()` — row-lock + `nextCode()` + `replicate()` (draft/v1) + replicate items ⇒ 201. `previewCode()` — scans `PI/`+`INV/`, returns next code, no lock.

## D5. Helpers
`prepareItems()`→`ProformaInvoiceItem::computeAmount()`; `aggregateTotals()` header totals; `resolveCachedLabels()` (+ manager default + `convert_from_code`); `nextCode`/`nextBtCode`/`currentFinancialYear`; `applyScope`/`assertScope`/`assertQuotationScope`/`userCanModify`/`applyFilters`.

## D6. Cross-cutting patterns
| Pattern | Where | Why |
|---|---|---|
| One-per-opportunity | store + fromQuotation | 409 on a second PI; standalone unlimited |
| DCP compliance gate | `missingMandatoryDocs()` | No PI without mandatory KYC/DD/TL |
| Faithful conversion | `fromQuotation()` | Copy fields+lines + provenance refs |
| Currency lock | `update()` | Line prices are quote-era; mixing currencies corrupts totals |
| Dual-lock codes | `nextCode`/`nextBtCode` | Race-free `PI/FY/SEQ` + `BT-####` |
| Edit/delete locks | signed / converted_to_contract | Protect signed & contracted docs |
| Victory advance | PI **sent-for-signature / emailed** | `update()` lets the lead enter Stage 6 (not "signed") |
| Signed lock | completed Zoho → `pi_signed_at` | Stages 3–5 become read-only |

## D7. Notes & caveats
- **DB is PostgreSQL** — advisory locks + regex scans (`PI/`+`INV/`, `BT-`).
- **BT sequence is tenant-global** (not per branch); PI/QT codes are per client + FY.
- **DCP gate covers `kyc`/`dd`/`tl` only** — trade documents (`td`) and quality (`qc`) are not blocking.
- **`victory_reached` / `shipment_code`** are derived in the list from the lead + shipment relations.

---

*Related: `QUOTATION.md` (the source of conversion) · `LEAD_ACKNOWLEDGEMENT_MASTER.md` · `../My WorkPlace/matrix-stages/` (the Stage-5 shell + Victory) · `../My WorkPlace/lead-worksheet/`.*
