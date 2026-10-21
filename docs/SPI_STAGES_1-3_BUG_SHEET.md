# SPI (Supplier Purchase Invoice) — Stages 01–03 Bug Sheet

**Checked:** 2026-10-19 · **Branch:** `saas` · **Method:** code review of all Stage 01–03 frontend + backend files, end to end (no runtime execution)
**Scope:** Stage 01 Supplier Details · Stage 02 Invoice + Products · Stage 03 Box Packaging · Dark mode / UI

**Severity:** **S1** money / stock / tenant leak / data loss · **S2** flow blocked or wrong data saved · **S3** display / UX only
**Area:** **FE** frontend · **BE** backend · **INT** integration (FE↔BE contract) · **UI** dark mode / layout
**Status:** `Open` · `Partly fixed` · `Fixed` · `Plausible` (seen in code, not reproduced)

FE paths are under `resources/js/pages/p2p/purchase-management/invoice/`. BE: `Ctl` = `app/Http/Controllers/Api/P2p/SupplierInvoiceController.php`, `Svc` = `app/Services/P2p/SupplierInvoiceService.php`, `BoxCtl` = `app/Http/Controllers/Api/P2p/SpiBoxController.php`.

---

## Summary

| Stage | FE | BE | INT | Total | S1 |
|---|---|---|---|---|---|
| Common (all stages) | – | 3 | – | 3 | 2 |
| Stage 01 — Supplier Details | 13 | 9 | 3 | 25 | 6 |
| Stage 02 — Invoice + Products | 13 | 14 | 4 | 31 | 8 |
| Stage 03 — Box Packaging | 19 | 11 | 7 | 37 | 8 |
| Stage 03 — Requirement gaps | – | – | – | 14 | 4 |
| Dark mode / UI / UX | – | – | – | 33 | 0 (2 × S2) |
| **Total** | | | | **143** | **28** |

---

## 0. Common — all stages

| ID | Area | Bug | Where | Sev | Status |
|---|---|---|---|---|---|
| SPI-C-01 | BE | No permission check on any `p2p/spi` endpoint — any active user (e.g. HR) can create / edit / delete / submit SPIs and boxes | `routes/api.php:546-582`, Ctl, BoxCtl | S1 | Open |
| SPI-C-02 | BE | Client admin cannot use SPI: no branch → 403 "No branch context" even on list; with branch → `branch_id` never set → NOT NULL 500 on create | Ctl:37, Ctl:329, `TenantContext.php:41` | S2 | Open |
| SPI-C-03 | BE | `submit()` has no status guard — re-submitting a cancelled / grn_pending / closed SPI flips it back to `mapped` | Ctl:552-608 | S1 | Open |

---

## 1. Stage 01 — Supplier Details

### Frontend
| ID | Bug | Where | Sev | Status |
|---|---|---|---|---|
| SPI1-F-01 | Stage 1 edits never saved — "Update & Next" only advances; `PUT /stage-1` has no FE caller | `InvoiceForm.tsx:188`, `spi-api.ts` | S2 | Open |
| SPI1-F-02 | On create only 4 fields sent — delivery location, transport, payment type, international fields dropped | `InvoiceForm.tsx:195-200` | S2 | Open |
| SPI1-F-03 | Exchange Rate input deletes every digit — regex `/[^d.]/g` (missing `\`), also allows multiple dots | `Step1SupplierDetails.tsx:312` | S2 | Open |
| SPI1-F-04 | Without-PO flow runs on mock data (`INVOICE_ROWS`, `PRODUCT_LINES`, `NEXT_INVOICE_NO`) and can never save ("Supplier not loaded") | `MapInvoiceModal.tsx:80`, `InvoiceForm.tsx:68,189`, `data.ts:142` | S2 | Open (card disabled) |
| SPI1-F-05 | PO open-qty load failure swallowed → every line treated fully open → can double-bill an already-billed PO | `InvoiceForm.tsx:121` | S1 | Open |
| SPI1-F-06 | Supplier / vault / currency load failures silent — blank address, "0% · Needs Review" shown as if non-compliant | `InvoiceForm.tsx:129,157`, `Step1SupplierDetails.tsx:98` | S3 | Open |
| SPI1-F-07 | Stepper jumps to any reached step without saving; Close / Back have no unsaved-changes confirm | `InvoiceForm.tsx:180,416` | S2 | Open |
| SPI1-F-08 | Reopening an SPI always starts at Stage 01 (`stage_completed` ignored); no draft persistence on reload | `invoice-draft.ts:168` | S3 | Open |
| SPI1-F-09 | PO picker lists already fully-invoiced POs → SPI code burned, then Stage 2 "Nothing to invoice" | `MapInvoiceModal.tsx:47` | S3 | Open |
| SPI1-F-10 | PO search fires a request per keystroke (no debounce); empty-search text says "No submitted purchase orders yet" | `MapInvoiceModal.tsx:149,152` | S3 | Open |
| SPI1-F-11 | Error banner always says "Could not load the purchase order:" even for non-PO messages; no Retry | `Step1SupplierDetails.tsx:244` | S3 | Open |
| SPI1-F-12 | GST scrutiny row with null `gst_number` blanks the supplier GSTIN → false "GST missing" risk | `invoice-draft.ts:121,163` | S3 | Plausible |
| SPI1-F-13 | Stale text: list brief shows 5 steps (wizard has 4); `ffd_transporter` PO type blank; header stays "Draft · not yet mapped"; 422 shown as toast only | `steps.tsx`, `spi-api.ts:420`, `InvoiceForm.tsx:206,400` | S3 | Open |

### Backend
| ID | Bug | Where | Sev | Status |
|---|---|---|---|---|
| SPI1-B-01 | `vendor_id` / `purchase_order_id` not validated for existence or tenant → another client's vendor name/risk leaks into list | Ctl:1164-1165, :204, :271 | S1 | Open |
| SPI1-B-02 | Vendor not checked against the PO's own vendor | Ctl:1164 | S1 | Open |
| SPI1-B-03 | No server PO status check — draft / cancelled / non-existent PO accepted (only FE picker filters) | Ctl `store()` | S1 | Open |
| SPI1-B-04 | `document_type` trusted from client — flips whether GST is nulled in pricing | Ctl `store()`, :1351 | S1 | Open |
| SPI1-B-05 | Third-party storage saves `warehouse_id` NULL and `isOwnWarehouse(null)` returns true → treated as own warehouse | Ctl:1238 | S2 | Open |
| SPI1-B-06 | Deleted SPI keeps the supplier invoice no. forever (unique rule + DB index count trashed rows); case-sensitive | Ctl:1206, supplier_invoices migration | S2 | Open |
| SPI1-B-07 | Invoice date: no check vs PO date; `before_or_equal:today` in UTC rejects today's date 00:00–05:30 IST | Ctl:1210, `config/app.php` | S2 | Open |
| SPI1-B-08 | `updateStage1` lets vendor / document_type / warehouse change after items, boxes or put-away exist | Ctl:366-376 | S2 | Open |
| SPI1-B-09 | No blacklist / GST-cancelled supplier gate at SPI create | Ctl `store()` | S2 | Plausible |

### Integration
| ID | Bug | Where | Sev | Status |
|---|---|---|---|---|
| SPI1-I-01 | Edit mode rebuilds Stage 1 from the PO, not the SPI's stored header — stored currency / FX / doc type never shown | `InvoiceForm.tsx:131`, `spi-api.ts:132` | S2 | Open |
| SPI1-I-02 | Home state hard-coded `'27'` (Maharashtra) decides CGST/SGST vs IGST when PO has no `tax_mode` | `invoice-products.ts:59`, `InvoiceForm.tsx:212` | S1 | Open |
| SPI1-I-03 | Orphan drafts: closing after Stage 1 or double-click leaves empty Draft SPI and burns the code; no idempotency | `Svc:79`, `InvoiceForm.tsx` | S3 | Open |

---

## 2. Stage 02 — Invoice + Products (3-way match)

### Frontend
| ID | Bug | Where | Sev | Status |
|---|---|---|---|---|
| SPI2-F-01 | GST % not editable; product refresh overwrites line GST with current master rate; saved `gst_pct` ignored on reload | `ProductTable.tsx:57`, `InvoiceForm.tsx:140` | S2 | Open |
| SPI2-F-02 | Negative qty accepted (`Number(v)||0`); zero / no-product lines silently dropped from save | `ProductTable.tsx:277`, `invoice-products.ts:246` | S2 | Open |
| SPI2-F-03 | Product picker lists only grid products; no Add Line → unordered / extra / service lines can't be billed; no discount column | `ProductTable.tsx:24-32` | S2 | Open |
| SPI2-F-04 | Saved items with null / deleted `po_item_id` vanish from grid and get cancelled on next save | `InvoiceForm.tsx:135-142` | S2 | Plausible |
| SPI2-F-05 | Direct (without-PO) SPI can't be created or reopened (Next disabled by `poError`) | `InvoiceForm.tsx:68,115-117,381` | S2 | Open |
| SPI2-F-06 | Float noise shown (0.30000000000000004); `round2` rounds 1.005 → 1.00 | `ProductTable.tsx:155-159,282`, `invoice-products.ts:105` | S3 | Open |
| SPI2-F-07 | Money always shown as ₹ even on international invoices | `ProductTable.tsx:12` | S3 | Open |
| SPI2-F-08 | PO cost column uses full PO qty while Qty(PO) shows open qty | `ProductTable.tsx` | S3 | Open |
| SPI2-F-09 | Invoice file input has no `accept` / size check; required in UI but `nullable` on server | `Step2InvoiceProducts.tsx:166`, `InvoiceForm.tsx:224`, Ctl:451 | S3 | Open |
| SPI2-F-10 | 422 shown as raw `items.N.rate` toast; N is filtered index, not grid row | `InvoiceForm.tsx:256` | S3 | Open |
| SPI2-F-11 | Double-click Next can write two saves / two ledger sets | `InvoiceForm.tsx` | S3 | Plausible |
| SPI2-F-12 | Fake `SPI/2025-26/…` number shown when next-code fails (error swallowed) | `data.ts:142`, `InvoiceForm.tsx:91` | S3 | Open |
| SPI2-F-13 | Evidence vault preview blob URL never revoked (memory leak) | `InvoiceEvidenceVault.tsx:80` | S3 | Open |

### Backend
| ID | Bug | Where | Sev | Status |
|---|---|---|---|---|
| SPI2-B-01 | Items upserted by `line_no` — removing / zeroing a line shifts products onto other item ids → packed boxes relabelled / orphaned; ledger wrong | `Svc:262-293` | S1 | Open |
| SPI2-B-02 | `qty_spi` can be cut below packed qty → negative pending; `submit()` only checks `> 0` | Ctl:399-538, `Svc:167`, Ctl:567 | S1 | Open |
| SPI2-B-03 | `po_item_id` not scoped to the SPI's PO or tenant (raw `DB::table`) → drains another PO's open qty, snapshots foreign description | Ctl:1308-1342 | S1 | Open |
| SPI2-B-04 | Tax / line totals / grand total stored as sent — no recompute; CGST+SGST and IGST both allowed on one line | Ctl:494-515 | S1 | Open |
| SPI2-B-05 | `product_id` not validated for tenant; product read unscoped → other client's product name leaks | Ctl:429, :1318, `SpiSummaryService.php:136,608` | S1 | Open |
| SPI2-B-06 | `product_id` not checked against the PO line's product → PO qty of P consumed, stock booked as Q | Ctl:429 | S1 | Open |
| SPI2-B-07 | Mapped (submitted, put-away) SPI still editable at Stage 02 (`isEditable` allows `mapped`) | `SupplierInvoice::isEditable`, `types.ts:83` | S1 | Open |
| SPI2-B-08 | Duplicate `po_item_id` rows in one payload each checked against full open qty → 2× billed, no warning | Ctl:1332, :1377 | S2 | Open |
| SPI2-B-09 | `missing_qty` accessor uses full PO qty, FE uses open qty → partial-billing SPIs show Missing / not matched | `SupplierInvoiceItem.php:64` | S2 | Open |
| SPI2-B-10 | `hsn_code`, `uom`, `qty_pi`, `po_line_total` never written — PI leg of 3-way match not stored | Ctl:1319-1342 | S2 | Open |
| SPI2-B-11 | `currency_code required_if:document_type` never fires (field not in request); FX never required | Ctl:1212 | S2 | Open |
| SPI2-B-12 | No lock / version check — concurrent edits overwrite silently; no unique `(spi_id, line_no)` | `updateItems`, items migration | S2 | Open |
| SPI2-B-13 | No max on qty / amounts → decimal overflow 500; concurrent duplicate invoice no. → 500 not 422 | Ctl:430-446 | S3 | Open |
| SPI2-B-14 | Standalone SPI takes `extra_qty` from payload; REVISED ledger row written every save even unchanged; file endpoint scoped by client not branch | Ctl:1334, `Svc:270`, `P2pFileController.php:103` | S3 | Open |

### Integration
| ID | Bug | Where | Sev | Status |
|---|---|---|---|---|
| SPI2-I-01 | FE Missing (open qty) vs BE `match` (full PO qty) disagree; FE ignores server `match` | `invoice-products.ts:105`, `SupplierInvoiceItem.php` | S2 | Open |
| SPI2-I-02 | FE decides export by supplier country, BE by `document_type` → domestic SPI saved with null GST | `invoice-products.ts:54` | S2 | Plausible |
| SPI2-I-03 | `spiItemId` mapped by array position on FE and `line_no` on BE → boxes point at wrong item when lines change | `InvoiceForm.tsx:244-248`, `Svc:262` | S1 | Open |
| SPI2-I-04 | International header tax stored 0 while line tax NULL; grand total trusted from FE | Ctl:496-498, :1351 | S3 | Open |

---

## 3. Stage 03 — Temporary Box Packaging

### Frontend
| ID | Bug | Where | Sev | Status |
|---|---|---|---|---|
| SPI3-F-01 | Box photos (Upload / Camera) never uploaded — local state only, lost on Save / close; no API exists | `BoxDrawer.tsx:178-248` | S1 | Open |
| SPI3-F-02 | CM/M and KG/G toggles only flip the label, values not converted → 50 cm saved as 5000 cm; 25 kg saved as 0.025 kg; unit not stored | `BoxDrawer.tsx:215-216,309-325` | S1 | Open |
| SPI3-F-03 | Split-box (s2) edit fails "at most 0 units" — own qty not excluded | `Step3BoxPackaging.tsx:281-286` | S2 | Partly fixed (s1/s3 ok) |
| SPI3-F-04 | Stage-3 sticker QR `BOX\|B-001\|…` not resolvable by put-away scan | `BoxStickerModal.tsx:21-22` | S1 | Partly fixed (PDF ok) |
| SPI3-F-05 | ✕ on scenario chip / Close on split offers to delete every saved box of that product (incl. mixed cartons) | `Step3BoxPackaging.tsx:601-618` | S2 | Open |
| SPI3-F-06 | Saved boxes have no quantity edit — only delete & repack | `Step3BoxPackaging.tsx:938-961` | S2 | Open |
| SPI3-F-07 | Sticker PDF / Print = `window.print()`; never hits server; SPI number "—"; sticker button disabled on new box | `BoxStickerModal.tsx:176-181`, `BoxDrawer.tsx:350,625` | S2 | Open |
| SPI3-F-08 | "Could not save the box" after a successful save (reload inside same try) → retry creates duplicate box | `InvoiceForm.tsx:316-335` | S2 | Open |
| SPI3-F-09 | Flags refetch after create ignores SPI branch → save 422 on flag | `InvoiceForm.tsx:470` | S2 | Open |
| SPI3-F-10 | Rows inside an open mixed carton stay selectable; re-packing silently replaces carton contents | `Step3BoxPackaging.tsx:216,749` | S3 | Open |
| SPI3-F-11 | Mixed-carton edit shows first SKU's qty as box total (also on sticker) | `Step3BoxPackaging.tsx:942` | S3 | Open |
| SPI3-F-12 | New boxes default Stackable = true (spec / DB default = not stackable) | `BoxDrawer.tsx:146` | S3 | Open |
| SPI3-F-13 | Condition `major` silently becomes `severe` on edit | `Step3BoxPackaging.tsx:505` | S3 | Open |
| SPI3-F-14 | Any edit blocked once expiry date has passed (even dimensions only) | `Step3BoxPackaging.tsx:292` | S3 | Open |
| SPI3-F-15 | Flag-master load failure swallowed → flags dropped → Cold Chain 422 | `InvoiceForm.tsx:282` | S3 | Open |
| SPI3-F-16 | Preview box code can differ from allocated code (B-003 shown, B-001 saved) | `Step3BoxPackaging.tsx:190-202` | S3 | Open |
| SPI3-F-17 | Bulk delete not atomic — partial failure leaves mixed state | `InvoiceForm.tsx:343` | S3 | Open |
| SPI3-F-18 | Packed Boxes table repeats line-level Missing/Extra on every box row | `PackedProducts.tsx:117,176` | S3 | Open |
| SPI3-F-19 | Photo picker accepts SVG / zero-byte, no size cap; edit-mode cold-chain note dropped; split panel float noise | `BoxDrawer.tsx:183,223`, `MultiBoxPanel.tsx:238` | S3 | Open |

### Backend
| ID | Bug | Where | Sev | Status |
|---|---|---|---|---|
| SPI3-B-01 | Over-pack race: `guardOverPacking` runs before the row lock; `update()` takes no lock | BoxCtl:164-170, 218-221 | S1 | Open |
| SPI3-B-02 | `update()` has no put-away check — placed box contents / weight / dims can be rewritten | BoxCtl:202-244 | S1 | Partly fixed (delete ok) |
| SPI3-B-03 | Client-admin boxes saved with `branch_id` NULL → visible / scannable from every branch | BoxCtl:172-180 | S1 | Open |
| SPI3-B-04 | Delete box doesn't release put-away row, scan task or shelf reservation | BoxCtl:257 | S2 | Open |
| SPI3-B-05 | `destroy()` has no `isEditable()` check (closed / grn_pending SPIs) | BoxCtl:247-262 | S2 | Open |
| SPI3-B-06 | No server check for expired goods / future MFG / expiry before invoice date | BoxCtl:618-622 | S2 | Open |
| SPI3-B-07 | Sticker PDF prints batch but not expiry per SKU | BoxCtl:388-393 | S2 | Open |
| SPI3-B-08 | Duplicate box code → 500 when NULL-branch SPI is packed from two branches | BoxCtl:699 | S2 | Plausible |
| SPI3-B-09 | `is_stackable: null` passes validation → NOT NULL 500 | BoxCtl:504,515 | S3 | Open |
| SPI3-B-10 | API accepts 0 / missing dimensions and gross weight (FE-only rule) | BoxCtl:494-499 | S3 | Open |
| SPI3-B-11 | Own-qty lookup keeps only last row for same item twice; `StickerKey::idFor` ignores signature; box codes sorted as strings | BoxCtl:719, `StickerKey.php:124`, BoxCtl:61 | S3 | Open |

### Integration
| ID | Bug | Where | Sev | Status |
|---|---|---|---|---|
| SPI3-I-01 | "Map Invoice" does nothing — no FE caller of `PUT /p2p/spi/{id}/submit`; SPI never becomes `mapped` | `InvoiceForm.tsx:366` | S1 | Open |
| SPI3-I-02 | Stage 3 → 4 gate is client-side only; `stage_completed` stays 2 on server | `InvoiceForm.tsx:181,369` | S2 | Open |
| SPI3-I-03 | Removing a packed line in Stage 2 soft-deletes item but leaves box items → hidden box blocks submit | `Svc saveItems`, Ctl:567 | S1 | Open |
| SPI3-I-04 | Boxes stay editable after submit (`isEditable` includes `mapped`) | `SupplierInvoice::isEditable` | S2 | Open |
| SPI3-I-05 | Deleting an SPI leaves boxes, put-away rows and shelf reservations live | Ctl:623-660 | S2 | Open |
| SPI3-I-06 | Evidence Vault / Summary always show 0 box attachments (nothing writes the table) | `SpiSummaryService.php:140,219,319` | S2 | Open |
| SPI3-I-07 | Three different QR payloads for one carton (Stage 3 modal / Stage 4 modal / PDF) | `BoxStickerModal.tsx`, `PutawayStickerModal.tsx:122`, BoxCtl:422 | S3 | Open |

### Requirement gaps vs `SPI_STAGE3_TEST_CASE_MATRIX.md`
| ID | Gap | AC / Case | Sev |
|---|---|---|---|
| SPI3-R-01 | No photo gallery (view / download / persist) | AC-BP-38, SPI3-129–136 | S1 |
| SPI3-R-02 | No cross-box CM/M + flags consistency popup | AC-BP-33/34, SPI3-103–109 | S1 |
| SPI3-R-03 | Unit switch doesn't convert values | AC-BP-16, SPI3-53/54 | S1 |
| SPI3-R-04 | Qty not editable after save | AC-BP-35, SPI3-111/113/119 | S1 |
| SPI3-R-05 | No PI QTY / PO QTY columns in grid | AC-BP-37, SPI3-121 | S2 |
| SPI3-R-06 | Colours swapped: Missing amber `#b45309`, Extra red `#dc2626` (spec: Missing red, Extra orange); 0 shown not "–" | `invoice-form.css:112-113`, SPI3-123/124 | S2 |
| SPI3-R-07 | Stage-3 sticker missing SPI code, PO, supplier, weight, dims, warehouse; QR broken | AC-BP-23, SPI3-75–77 | S2 |
| SPI3-R-08 | No per-SKU expiry on any sticker | SPI3-101 | S2 |
| SPI3-R-09 | Expiry before invoice date not checked | AC-BP-32, SPI3-99 | S2 |
| SPI3-R-10 | No photo file-type / size rules | AC-BP-22, SPI3-69/70 | S2 |
| SPI3-R-11 | No permission gating on Stage 3 | AC-BP-28, SPI3-88 | S2 |
| SPI3-R-12 | Single `B-###` sequence; no `PUT-B` / `PUT-MB` split | AC-BP-14, SPI3-30/35/50 | S3 |
| SPI3-R-13 | Scenario lock lost on reload; no UOM whole-unit rule | AC-BP-05, SPI3-120 | S3 |
| SPI3-R-14 | "Mismatched" condition doesn't capture product actually received | SPI3-64 | S3 |

**Met:** SPI3-137 (Serial/Lot/Batch/MFG/Expiry columns) · SPI3-73 (no Scan on box card) · SPI3-37/40 (split sums exactly) · SPI3-57 (net ≤ gross both sides).

---

## 5. Dark mode / UI

Dark mode is toggled by `data-bs-theme="dark"` on `<html>` (`app.tsx:26`, `ThemeContext.tsx:34`). `data-layout-mode` is never set anywhere. `if.css` = `invoice-form.css` (lines 2375+ are Stage 04, excluded).

### Dark mode
| ID | Bug (what user sees) | Where | Sev | Status |
|---|---|---|---|---|
| SPI-DM-01 | Empty box chips in "Generated Boxes" stay near-white; light-cyan box ID on it is unreadable | `if.css:788` (0,3,0) beats dark `if.css:1934` | S2 | Open |
| SPI-DM-02 | Boxed / Pending / Total pills all the same cyan — dark rule overrides the colour variants | `if.css:190-192` vs `if.css:1518` | S3 | Open |
| SPI-DM-03 | Footer progress dots all grey — done / current step indistinguishable | `p2p-detail.css:719-721` | S3 | Open |
| SPI-DM-04 | No focus ring on Sub-Box Count and dimension / weight inputs (dark rule sets `box-shadow:none`) | `if.css:229,339` vs `1525,1653,1968` | S3 | Open |
| SPI-DM-05 | White "Clear Selection" button in mixed-carton header | `if.css:1252,1264` | S3 | Open |
| SPI-DM-06 | Bright light-cyan checkboxes column in Stage 3 table | `if.css:215-216,611` (`.vti-cb`) | S3 | Open |
| SPI-DM-07 | Selection bar + white "Pack into 1 Box" glow at full light-mode brightness | `if.css:695,269-270` | S3 | Open |
| SPI-DM-08 | Scenario / remark / condition cards give no hover feedback in dark | `if.css:532-571` | S3 | Open |
| SPI-DM-09 | Low contrast (~3:1): PO cost column, drawer mini titles / unit tags, sticker mono text, Evidence Vault status (inline colour), custom flag chips (inline colour) | `if.css:95,343,355,1433`; `InvoiceEvidenceVault.tsx:22,154`; `BoxDrawer.tsx:485,557`; `ProductFlagsModal.tsx:131` | S3 | Open |
| SPI-DM-10 | Near-white hairline under each "What We Did" stage header | `p2p-detail.css:279` | S3 | Open |
| SPI-DM-11 | Zebra stripes only in dark, and parity flips when a drawer opens / per carton tbody | `if.css:1493` | S3 | Open |
| SPI-DM-12 | Duplicate competing dark values (`.pkg-box__body`, `.pkg-card*`) and dead `[data-layout-mode]` selectors | `if.css:1608-1616,1809` vs `4930-4938`; `if.css:390-439` | S3 | Open (maintenance) |

### Layout / responsive
| ID | Bug | Where | Sev | Status |
|---|---|---|---|---|
| SPI-UI-01 | Box drawer toolbar (~800px) can't wrap → table scrolls sideways below ~1300px, Save / Close off-screen on tablet/phone | `if.css:272,335,348,1033-1034` | S3 | Open |
| SPI-UI-02 | Unscoped SPI CSS leaks into Create PO after an SPI is opened (`.cpd-kv`, `.cpd-foot-final`, `.spi-dt-head`, `.spi-mdl-confirm.is-off`) | `if.css:116,123,825-836,1193` | S3 | Open |
| SPI-UI-03 | Hidden scrollbars on multi-box tabs; selected-product chips cut off with no "+N" | `if.css:263,625-626` | S3 | Open |
| SPI-UI-04 | "3-Way Product Mapping" band stays sticky on phones while columns scroll | `if.css:36-42` vs `create-po.css:1687` | S3 | Open |
| SPI-UI-05 | Mixed-carton table > 1,500px wide (11 cols × min 130px) | `if.css:1220` | S3 | Open |
| SPI-UI-06 | 6.5–8px text in drawer labels / tags / sticker temp | `if.css:284,342-344,355,1285` | S3 | Open |
| SPI-UI-07 | Loading skeleton fixed widths ignore the 760px breakpoint | `InvoiceForm.tsx:526-527,589` | S3 | Open |

### UX / labels / accessibility
| ID | Bug | Where | Sev | Status |
|---|---|---|---|---|
| SPI-UX-01 | Zoho Sync button on list does nothing (falls to `console.info`) | `cells/ZohoCell.tsx:38`, `InvoiceList.tsx:105-127` | S2 | Open |
| SPI-UX-02 | View-only SPI still shows enabled Stage 3 controls (checkboxes, Single Box, Pack, toggles, Upload) and Stage 1 "Edit supplier" pencil | `Step3BoxPackaging.tsx:211`, `InvoiceForm.tsx:458`, `Step1SupplierDetails.tsx:392` | S3 | Open |
| SPI-UX-03 | Stage 2 "Tinted cells are editable" legend shown on read-only invoice | `ProductTable.tsx:74-78` | S3 | Open |
| SPI-UX-04 | Empty states wrong: "All 0 products packed in 0 boxes"; no empty row in Stage 2; list shows "No invoices" after a load error | `Step3BoxPackaging.tsx:906`, `ProductTable.tsx:140`, `InvoiceList.tsx:250` | S3 | Open |
| SPI-UX-05 | "× Close" / "✓ N Boxes" buttons actually delete saved boxes (after confirm) — labels mislead | `MultiBoxPanel.tsx:75`, `Step3BoxPackaging.tsx:850` | S3 | Open |
| SPI-UX-06 | "Change Selection" on Stage 1 closes the whole form | `InvoiceForm.tsx:382,501` | S3 | Open |
| SPI-UX-07 | Typos / labels: "Domestics", "All SPI's", "Zohobook", "Enforced on this PO", two columns both "Total Product Cost / With GST", mixed Title/ALL CAPS, " — X" when code blank | `Step1SupplierDetails.tsx:28,629`, `InvoiceList.tsx:183,333`, `ProductTable.tsx:124,135`, `StageSummary.tsx:59` | S3 | Open |
| SPI-UX-08 | Close / Back / Apply / Pack / Single Box not disabled while saving; Single Box has no pressed style | `InvoiceForm.tsx:416,500`, `Step3BoxPackaging.tsx:861` | S3 | Open |
| SPI-UX-09 | Accessibility: clickable divs w/o role / keyboard; icon buttons w/o `aria-label`; labels w/o `htmlFor`; no `aria-pressed` / `aria-expanded` / tab roles; no Esc / focus in 6 modals | Step1/2/3, `BoxDrawer.tsx`, `MultiBoxPanel.tsx:63`, `InvoiceForm.tsx:422` | S3 | Open |
| SPI-UX-10 | Step cards lose DONE badge after stepping back (`i < stage` not `reached`); unreachable cards still look clickable | `InvoiceForm.tsx:422-430` | S3 | Open |
| SPI-UX-11 | Sticker Print prints the whole app page (no `@media print` in p2p) | `BoxStickerModal.tsx:176-181` | S3 | Open |
| SPI-UX-12 | Hard-coded data: Countries (4) / States (5) lists, static guidelines, one-option "Auto" Mode select | `Step1SupplierDetails.tsx:39-51`, `Step3BoxPackaging.tsx:828` | S3 | Open |
| SPI-UX-13 | Clearing qty / rate snaps to 0; uploaded file name not a link; Storage modal load error has no Retry | `ProductTable.tsx:274-294`, `StorageSelectionModal.tsx:212` | S3 | Open |
| SPI-UX-14 | Dead CSS: `.vti-flagcard*`, `.vti-extra-badge`, `.invf-scn-tag__no`, `.spi-delrow`, duplicate `.vti-dw-strip` / `.pkg-card__use`; `ProductFlagsModal.tsx` component unused | `if.css:125-138,222,492-517,601,733` | S3 | Open (maintenance) |

**Checked and clean in dark:** shared `spi-dt-*` / `cpd-*` chrome, date picker, MasterSelect, attachment popover, Storage modal, Map modal, Evidence Vault, put-away sticker/summary; `color-scheme: dark` set for native controls; white QR backgrounds intentional.

---

## Fix priority (top 10)

1. SPI3-I-01 — wire Map Invoice → `submit`
2. SPI2-B-01 / SPI2-I-03 — match items by `po_item_id` / id, not position
3. SPI2-B-03 / SPI1-B-01 / SPI2-B-05 — scope vendor, PO, PO item, product to tenant + SPI's PO
4. SPI2-B-04 — recompute tax and totals server-side
5. SPI3-F-02 — convert values on unit toggle
6. SPI3-F-01 / SPI3-R-01 — box photo upload endpoint + gallery
7. SPI3-B-01 — lock before over-pack guard; lock in `update()`
8. SPI-C-01 — permission gate on SPI routes
9. SPI1-F-01 — call `PUT /stage-1` on Update & Next
10. SPI-C-02 / SPI3-B-03 — set `branch_id` from SPI / user on create
