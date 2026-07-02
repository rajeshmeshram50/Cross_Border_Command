# MATRIX STAGES MODULE — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · Sales Matrix → Opportunity Pipeline (6 stages)
> A guided, file-by-file trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial code walkthrough |

---

## 0. HOW TO READ THIS DOCUMENT
Follows an opportunity through the 6 stages in execution order. Line numbers reference the live source and may drift; method names are stable. Legend: `→` a call · `⇒` a return.

Primary files:
- Shell: `matrix/SalesMatrixDetail.tsx` · `matrix/TaskManagerPanel.tsx` · `matrix/stages/Stage1..6.tsx`
- Backend: `SalesLeadController` (stage 1–4) · `QuotationController` · `ProformaInvoiceController` · `ProcurementController` · `ShipmentOrderController` · `SalesPdfController` · `SalesTodoController`

> **Boundary:** this is the "inside the stages" module — opened from the Lead Worksheet at `/sales/matrix/{oppId}/stage/{stage}`. The worksheet toolbar (Add/Assign/Distribution) is documented separately.

---

## 1. THE MATRIX SHELL — `SalesMatrixDetail.tsx`
```tsx
const oppId = decodeOppId(params.oppId);          // encrypted → OPP-####
const stage = decodeStage(params.stage);          // clamp 1..6
const furthestStage = Math.max(stage, serverHeader.leadStageId ?? 0);
const goToStage = n => { if (n > furthestStage) return; navStage(n); };   // locked steps are no-ops
const isSigned = !!serverHeader.piSignedAt;        // PI-signed → center read-only
```
Three zones render side by side: **LEFT CLM** (customer/consignee vault tallies from `/segment-uploads/{type}/{id}/vault`; a Segment-Details card gated on a PI, from `/clm/leads/{leadId}/agreement-applicable`), **CENTER** the active `StageComponent` (passed `header`, `onNext/onPrev`, `reloadLead`, `locked=isSigned`), **RIGHT** the `TaskManagerPanel`. Toolbar → Change Owner / Remark / Key Opportunity (all `PUT /sales/leads/{id}`), Reminders/Meetings, WhatsApp, agreement send.

---

## 2. STAGE 1 — INQUIRY (Task Manager)
Right-panel `TaskManagerPanel` posts the Purchase Decision Maker:
```tsx
const fd = new FormData(); fd.append('name', …); fd.append('mobile_no', …); fd.append('email', …);
fd.append('order_value', …); fd.append('buying_plan', …); fd.append('attachment', file);
await api.post(`/sales/leads/${leadId}/task-manager`, fd);   // upsert per (client_id, lead_id)
```
Stage 1's **Save & Next** validates PDM name+mobile+email, then `PUT /sales/leads/{id} { lead_stage_id: 2 }`. Backend `storeTaskManager()` (995) upserts `LeadTaskManager` (replaces the attachment on disk if a new one is sent).

---

## 3. STAGE 2 — ACKNOWLEDGEMENT
```tsx
// pick a bucket pill → reason picker → submit
await api.post(`/sales/leads/${leadId}/acknowledgements`, { reason_ids });   // same opportunity_type
// Save & Next requires latest bucket === 'qualified'
await api.put(`/sales/leads/${leadId}`, { lead_stage_id: 3 });
```
`storeAcknowledgements()` (1725, txn) inserts `LeadAcknowledgement` rows (snapshotting `reason_snapshot`/`dq_status`) and flips `lead.qualified`/`disqualified` — but does **not** move the stage (the SPA's `PUT` does).

---

## 4. STAGE 3 — PRODUCT SOURCING
```tsx
GET  /sales/leads/{id}/products                                   // rows + sourcing_status + procurement_id
PATCH /sales/leads/{id}/products/{m}/sourcing-status {required|not_required}
POST  /procurements { lead_id, products:[{ product_id, lead_product_id, qty, target_price, vendor_id? }] }
PATCH /sales/leads/{id}/products/{m}/mark-sourced                 // needs a linked procurement → procurement_done=true
```
`ProcurementController::store()` (33) tenant-gates the lead/products/vendors, **auto-assigns a vendor** when a product has exactly one `vendor_product_mapping`, and writes `Procurement` + `ProcurementProduct` rows. `updateLeadProductSourcingStatus()` (1196): flipping to *not_required* clears `procurement_done`. Advance → `PUT lead_stage_id: 4` once the readiness checklist passes. From here, `destroyLeadProduct()` (1648) returns **422** (`lead_stage_id ≥ 4` locks the product list).

---

## 5. STAGE 4 — PRICE SHARED
```tsx
POST /sales/leads/{id}/products/{m}/shared-prices { quoted_price }   // append-only
GET  /sales/leads/{id}/shared-prices                                 // history
GET  /sales/shared-prices/{entryId}/pdf                              // barcoded PDF (blob)
```
Advance needs a mapped customer + ≥1 shared price → `PUT lead_stage_id: 5`. `sharedPricePdf()` (1438) renders a tenant-branded PDF with a Code-128 `Q-#####` barcode.

---

## 6. STAGE 5 — QUOTATION vs PI

### 6.1 Quotation code allocation — `QuotationController::nextCode()` (600)
```php
DB::table('clients')->where('id', $clientId)->lockForUpdate()->first();     // row lock
DB::selectOne('SELECT pg_advisory_xact_lock(?)', [crc32("qt-code:$clientId:$fy")]);  // advisory
// FY: Jan–Mar → (year-1)-year ; else year-(year+1)
return "QT/$fy/" . ($maxSeq + 1);
```
`store()` validates, allocates the code, **recomputes line amounts** (`qty × rate × (1+tax%/100)`), caches customer/opp/manager labels, and writes `Quotation` + `QuotationItem` rows. `update()` (184) blocks if the quotation is `converted_to_pi` or has a completed signature, replaces items wholesale, bumps `version`, and supersedes the e-signature.

### 6.2 Convert to PI — `ProformaInvoiceController::fromQuotation()` (458)
```php
// gates: not already converted/cancelled · one-PI-per-opp (409 + existing_pi) · partyDocsBlockResponse (DCP)
$pi = ProformaInvoice::create($copiedFields + [
  'code' => $this->nextCode($clientId),           // PI/FY/SEQ  (scans PI/ + legacy INV/)
  'bt_id' => $piType==='with_shipment' ? $this->nextBtCode($clientId) : null,   // BT-####
  'source_quotation_id' => $qt->id, 'convert_from_code' => $qt->code,
]);
foreach ($qt->items as $i) ProformaInvoiceItem::create([...copy line...]);       // qty/rate/tax/amount
$qt->update(['status' => 'converted_to_pi']);
```
The PI's currency is then **locked** (a `PUT` that changes it → 422). The SPA's **Send for Signature** posts to `/clm/signature-requests/send`; on completion the lead carries `pi_signed_at`.

### 6.3 Email + signed link — `SalesPdfController`
```php
emailProformaInvoice(): resolve recipient → RateLimiter (3/min) → render PDF (fresh) →
  $viewUrl = URL::temporarySignedRoute('sales.pi.view', now()->addDays(60), ['id'=>$pi->id]);
  Mail::to($to)->send(new SalesDocumentEmail($payload));
  if (empty($pi->emailed_at)) $pi->emailed_at = now();     // idempotent anchor
// remind*(): 422 if never emailed → fresh PDF + fresh 60-day link → reminder_count++
```
`publicViewProformaInvoice()` (444) sits behind `signed` middleware — inline PDF, no login, dead after 60 days. `renderSalesPdfCached()` (982) keys on `md5(viewData + signature)` → disk cache. **One shared Blade** renders quotation & PI (only `pdf_title` differs); the **`signature` flag** (default true) toggles the authorised-signatory block; every page carries a top-right **Code-128 barcode** (branch website/org). `renderSalesDocPdfToTemp()` reuses the same with-signature bytes for the Zoho send. *(This is the **Stage-5** doc PDF — the **Stage-4 shared-price** PDF with the `Q-#####` barcode is `SalesLeadController::sharedPricePdf()`, §5.)*

---

## 7. STAGE 6 — VICTORY
Advance to Stage 6 requires a non-cancelled PI **sent for signature or emailed** (not necessarily signed — `SalesLeadController::update()`); `PUT lead_stage_id: 6` stamps `won_at`. The SPA fires confetti (RupeeRain — localStorage prevents repeat, sessionStorage forces one burst after Save & Next). **Create Shipment ID**:
```php
ShipmentOrderController::store() (16):
  // tenant-gate lead + PI · one-shipment-per-opp (unique lead_id → 409) · lockForUpdate('clients')
  $code = $this->nextShipmentCode($branchId);         // SHP-### per branch (regexp_replace + max+1)
  ShipmentOrder::create([...logistics...] + ['shipment_code'=>$code, 'lead_id'=>…, 'proforma_invoice_id'=>…]);
```
Post-save the SPA shows the shipment/inquiry/logistics cards.

---

## 8. SIDE PANELS — Reminders & Meetings (`SalesTodoController`)
```php
storeReminder() (54): SalesReminder + attachment → sales-todo/reminders/{clientId}/YYYY/MM
storeMeeting()  (200): allocateMeetingCode() (457, lockForUpdate withTrashed) → M-### (virtual) / P-### (physical)
// both owner-scoped via applyScope() (created_by_user_id); scope=all only for admins
```

---

## 9. CROSS-CUTTING PATTERNS
| Pattern | Where | Why |
|---|---|---|
| Earned progression | `furthestStage` + per-stage `PUT lead_stage_id` | Can't skip ahead of the current stage |
| PI-signed lock | `isSigned = piSignedAt` | Center read-only after signature; toolbar/panels stay live |
| FY + double lock codes | `nextCode()` (QT/PI) · advisory + row lock | Race-free, gap-free per-client codes |
| Server-side totals | quotation/PI `store` | Never trust client math |
| Item copy on convert | `fromQuotation()` | PI snapshots the quote's lines + source refs |
| One-per-opportunity | PI + shipment unique constraints | 409 on a second |
| Product list lock | `destroyLeadProduct` at `stage ≥ 4` | Protect downstream quotation/PI items |
| Signed public links | `SalesPdfController` + `signed` mw | Deliver docs without login, 60-day expiry |
| Sole-vendor auto-assign | `ProcurementController::store` | One-mapping products need no manual pick |

---

## 10. NOTES & CAVEATS
- **DB is PostgreSQL** — advisory locks + `regexp_replace` in code allocation.
- **PDF cache** keys on content + signature flag; template edits need a manual clear.
- **`convert-to-pi` on the quotation** only marks intent — the real copy is PI `from-quotation`.
- **Currency lock** on from-quotation PIs prevents mixed-currency line/total mismatch.
- **Victory** advances once the PI is **sent for signature or emailed** (not signed); a *completed* `ClmSignatureRequest` stamps `pi_signed_at` (the read-only lock). `won_at` is stamped on entering Stage 6.
- **Documents are soft-cancelled** (status), never hard-deleted — the audit chain (`source_quotation_id`/`convert_from_code`/`proforma_invoice_id`) is preserved.

---

*Related documents: MATRIX_STAGES_TECHNICAL_DOCUMENTATION.md · MATRIX_STAGES_FUNCTIONAL_DOCUMENTATION.md · MATRIX_STAGES_API_DOCUMENTATION.md*
