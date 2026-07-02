# PROFORMA INVOICE — COMBINED DOCUMENTATION

> Cross_Border_Command SaaS ERP · Sales Matrix → Stage 5 (Quotation vs PI) → **Proforma Invoice (PI)**
> **Single-file KT** — Functional · Technical · API · Code-Walkthrough in one document.
> Base URL: `{APP_URL}/api` · All endpoints require `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-02 | System | Initial combined documentation |

**Scope:** the **Proforma Invoice** entity in **Stage 5** — the binding priced document a customer signs before shipment. A PI is usually created by **converting a Quotation** (see sibling `QUOTATION.md`) but can also be built standalone. The 6-stage shell is in `../matrix-stages/`.

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

## A4. Where it lives in the UI
Stage 5 (`Stage5QuotationVsPI.tsx`) — the **Proforma Invoice** tab. **Create PI** greys out if the deal is locked, a PI already exists (one-per-opp), or mandatory docs aren't 100% uploaded. The PI row shows **Converted From**, a **Status** e-signature pill (**Not Sent → Sent → Signed**, synced ~20s), and per-row actions (Send for Signature, Remind, View/Download signed PDF + Certificate, Edit, Delete, Email). In the list, a PI surfaces in the **With-Shipment** view once its opportunity reaches Victory (`lead_stage_id ≥ 6` or `won_at` set), and carries the `SHP-###` shipment code once a shipment order exists.

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
Same contract as Quotation — `preview-pdf` (cached blob), `email` (**3/min**, stamps `emailed_at`, 60-day signed link), `remind` (**422** if never emailed; fresh link; `reminder_count++`), `view` (**public**, `signed`, 60-day). A completed Zoho request stamps `pi_signed_at` → unlocks **Victory (Stage 6)**.

### C10. Error examples
```json
409 { "status":false, "message":"Opportunity OPP-2026-001 already has a PI: PI/2026-27/1. Only one PI is allowed per opportunity.",
      "existing_pi": { "id":1, "code":"PI/2026-27/1" } }
422 { "status":false, "message":"This Proforma Invoice can't be created yet — some required documents are still pending… Pending: Customer → Certificate of Incorporation, Trade License | Consignee → Due Diligence Report +1 more" }
422 { "status":false, "message":"This PI was created from a quotation and is locked to USD. Use a fresh PI to invoice in a different currency." }
409 { "status":false, "message":"This PI has already been signed and can no longer be edited. Duplicate it to make changes." }
```

---

# PART D — CODE WALKTHROUGH

> Legend: `→` call · `⇒` return. Line numbers reference live source and may drift.

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
| Victory gate | signed PI → `pi_signed_at` | Unlocks Stage 6 |

## D7. Notes & caveats
- **DB is PostgreSQL** — advisory locks + regex scans (`PI/`+`INV/`, `BT-`).
- **BT sequence is tenant-global** (not per branch); PI/QT codes are per client + FY.
- **DCP gate covers `kyc`/`dd`/`tl` only** — trade documents (`td`) and quality (`qc`) are not blocking.
- **`victory_reached` / `shipment_code`** are derived in the list from the lead + shipment relations.

---

*Related: `QUOTATION.md` (the source of conversion) · `LEAD_ACKNOWLEDGEMENT_MASTER.md` · `../matrix-stages/` (the Stage-5 shell + Victory) · `../lead-worksheet/`.*
