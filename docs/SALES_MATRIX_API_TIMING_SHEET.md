# Sales Matrix — API Timing Sheet

> Measured on 2026-10-22 on the local dev stack. Every number in this sheet was measured, except the ones marked **est.**
> Scope: the Sales Matrix detail page (`/sales/matrix/:oppId/stage/:stage`) — the page shell, Stages 1–6, and the modals each stage opens.

---

## 1. How to read this sheet

Each API call is measured at two points:

| Column | What it means | How it was measured |
|---|---|---|
| **Server time** | Time Laravel spends on the request *after* the framework has booted: middleware → controller → DB → JSON. This is the "time it takes at the server's end". | In-process: the request is sent through the HTTP kernel 5× (7× on the final run) after one warm-up. The median is reported. |
| **DB queries / DB ms** | Number of SQL queries and the total time PostgreSQL spent on them. | `DB::listen` during the same runs. |
| **PHP/app ms** | Server time − DB ms, i.e. PHP execution (hydrating models, loops, building JSON). | Derived. |
| **Client sees** | What the browser actually waits for: TCP connect + framework boot + server time + transfer. | `curl` against the running `php artisan serve` on `127.0.0.1:8000`, 5 runs after a warm-up, same token and headers the SPA sends. |
| **Overhead** | Client sees − Server time. This is pure framework boot, unrelated to the API's own work. | Derived. |
| **With OPcache** | The same call on an identical server with OPcache enabled (test port 8011; the real config was not changed). | `curl`, 5 runs. Response bodies matched port 8000 byte-for-byte. |

**Test setup**

| Item | Value |
|---|---|
| DB | PostgreSQL `suraj_db` (127.0.0.1:5432) |
| Server | `php artisan serve` (PHP 8.2.12 built-in server), `APP_ENV=local`, `APP_DEBUG=true` |
| User | AgroTech Private Limited (`users.id=4`, branch_user, client 1, branch 3). `branch_id=3` is added to GETs the way the Axios interceptor does. |
| Opportunity | `OPP-0003` (`leads.id=184`): stage 6, customer 13, consignee 7, 3 mapped products, 4 shared prices, 1 quotation, 1 PI, 1 shipment order |
| Writes (POST/PUT/PATCH) | Run in-process inside a DB transaction that is **rolled back**. No test data was left behind (checked afterwards). Writes were not sent over HTTP, so their "client sees" values are **est.** = server time + the median measured overhead. |

---

## 2. Headline numbers

| Metric | Value |
|---|---|
| Endpoints measured | **47** (31 GET loads + 16 write actions) across the page shell and 6 stages |
| Typical **server time** per call | **5–20 ms** (median ≈ 10 ms). Only 4 calls exceed 100 ms (see §5). |
| Typical **client wait** per call, as-is | **≈ 450–1,150 ms** (average 665 ms in the final pass) |
| Share of the wait that is framework boot | **≈ 95%**. The health route `/up` does no work and still takes **0.39–1.25 s**. |
| Same calls with OPcache on | average **153 ms** (≈ 4.3× faster) |
| Worst page load | Page open: 6 parallel calls take **3.5 s** as-is, of which only 325 ms is server work |
| Parallel requests | **Run one at a time.** On Windows the PHP built-in server has one worker (`PHP_CLI_SERVER_WORKERS` is not supported), so the stage's `Promise.all` batches queue up. |

**Bottom line:** the Sales Matrix APIs themselves are fast. Nearly all the time the user waits is the dev server booting Laravel from scratch on every request (no OPcache, no config/route cache) and handling requests one at a time.

---

## 3. Per-stage page-load time (what the user waits for)

Every call a stage fires when it opens, sent **in parallel** the way the page does (`curl --parallel`), median of 5 runs.

| Stage / screen | Parallel calls | Sum of server time (ms) | Total DB queries | **Client wait as-is (ms)** | **Client wait with OPcache (ms)** | Speed-up |
|---|---|---|---|---|---|---|
| Page open (header + customer + consignee + 2 vaults + CLM card) | 6 | 325 | 108 | **3,455** | **1,178** | 2.9x |
| Stage 2 Lead Acknowledgement load | 1 | 6 | 5 | **522** | **136** | 3.8x |
| Stage 3 Product Sourcing load | 1 | 9 | 13 | **489** | **125** | 3.9x |
| Stage 3 Product Directory modal open | 3 | 44 | 37 | **1,713** | **389** | 4.4x |
| Stage 4 Price Shared load | 2 | 19 | 22 | **1,094** | **325** | 3.4x |
| Stage 5 Quotation vs PI load | 3 | 37 | 35 | **2,001** | **480** | 4.2x |
| Stage 6 Victory load | 5 | 64 | 71 | **3,029** | **911** | 3.3x |
| Stage 6 Create Procurement modal open | 2 | 16 | 15 | **1,139** | **279** | 4.1x |

The OPcache server is also single-worker, so its batches still queue. With a multi-worker server (Apache/Nginx + PHP-FPM) a batch would finish in about the time of its slowest call.

### Round trips per user action

Most saves are followed by a re-read, so the user waits for **two** round trips:

| Action | Calls (in order) | Wait as-is | Wait with OPcache |
|---|---|---|---|
| Stage 1 → 2 Save & Next | `PUT /sales/leads/{id}` → `GET /sales/leads/{id}` (reloadLead) | ≈ 1.3 s | ≈ 0.3 s |
| Stage 2 submit acknowledgement | `POST …/acknowledgements` → `GET /sales/leads/{id}` | ≈ 1.3 s | ≈ 0.3 s |
| Stage 2/3/4/5 Save & Next | `PUT /sales/leads/{id}` → `GET /sales/leads/{id}` | ≈ 1.3 s | ≈ 0.3 s |
| Stage 4 record quoted price | `POST …/products/{m}/shared-prices` → `GET …/shared-prices` | ≈ 1.3 s | ≈ 0.3 s |
| Header save (customer / consignee / remark) | `PUT /sales/leads/{id}` → `GET /sales/leads/{id}` | ≈ 1.3 s | ≈ 0.3 s |
| Stage 5 convert Quotation → PI | `POST …/from-quotation/{q}` → `GET` quotations + PIs | ≈ 2.0 s | ≈ 0.6 s |

---

## 4. Endpoint-by-endpoint timings

⚠ = server time ≥ 100 ms. All HTTP codes are what the endpoint returned for a valid request. `409` / `422` responses were fixed by correcting the test payload and re-measuring; none remain.

### Page shell

| # | UI action | Method | Endpoint (as the page calls it) | Type | HTTP | Server time ms (median) | Server min–max | DB queries | DB ms | PHP/app ms | Response | Client sees ms, avg (min–max) | Overhead ms (client − server) | With OPcache ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Open opportunity (resolve opp code) | `GET` | `/api/sales/leads?search=OPP-0003&status=all&per_page=5&page=1&with_counts=0&branch_id=3` | Load | 200 | **13.1** | 12.5–14.6 | 10 | 7 | 6.1 | 1.7 KB | **544 (465–695)** | 530 | 151 |
| 2 | Lead header (reloadLead) - runs after every save | `GET` | `/api/sales/leads/184?branch_id=3` | Load | 200 | **11.9** | 11.3–16.3 | 18 | 5.7 | 6.2 | 3.4 KB | **710 (623–867)** | 699 | 155 |
| 3 | Customer picker list | `GET` | `/api/customers?tab=all&branch_id=3` | Load | 200 | **12.3** | 11.5–13.5 | 8 | 5.2 | 7.1 | 18.1 KB | **578 (490–718)** | 566 | 157 |
| 4 | Consignee list for customer | `GET` | `/api/consignees?customer_id=13&branch_id=3` | Load | 200 | **9.7** | 9–11.2 | 10 | 4.9 | 4.8 | 3.4 KB | **533 (486–633)** | 524 | 142 |
| 5 | Customer KYC vault | `GET` | `/api/segment-uploads/customer/13/vault?branch_id=3` | Load | 200 | **128.9** ⚠ | 125.6–148.6 | 23 | 17.1 | 111.8 | 11.7 KB | **820 (760–926)** | 692 | 256 |
| 6 | Consignee KYC vault | `GET` | `/api/segment-uploads/consignee/7/vault?branch_id=3` | Load | 200 | **139.4** ⚠ | 131.4–153.7 | 25 | 21.6 | 117.8 | 10.8 KB | **737 (704–810)** | 598 | 245 |
| 7 | Agreement applicability (CLM) | `GET` | `/api/clm/leads/184/agreement-applicable?branch_id=3` | Load | 200 | **22.5** | 15.7–28.6 | 24 | 8.7 | 13.8 | 3.6 KB | **576 (545–645)** | 554 | 154 |
| 8 | Meetings list modal | `GET` | `/api/sales/meetings?scope=mine&search=OPP-0003&branch_id=3` | Load | 200 | **4.5** | 4.2–5 | 5 | 2.2 | 2.3 | 2 B | **538 (463–592)** | 533 | 115 |
| 9 | Reminders list modal | `GET` | `/api/sales/reminders?scope=mine&search=OPP-0003&branch_id=3` | Load | 200 | **5.9** | 5.6–5.9 | 5 | 2.6 | 3.3 | 2 B | **465 (449–501)** | 459 | 147 |
| 10 | Save header (customer/consignee/remark) | `PUT` | `/api/sales/leads/184` | Action | 200 | **8.4** | 8.1–22.8 | 7 | 3.5 | 4.9 | 1.2 KB | **~636 est.** | ~628 est. | ~139 est. |
| 11 | Add meeting | `POST` | `/api/sales/meetings` | Action | 201 | **9.6** | 9.1–20.3 | 9 | 4.2 | 5.4 | 578 B | **~638 est.** | ~628 est. | ~141 est. |
| 12 | Add reminder | `POST` | `/api/sales/reminders` | Action | 201 | **7.9** | 7.2–8.4 | 7 | 3.2 | 4.7 | 429 B | **~636 est.** | ~628 est. | ~139 est. |
| 13 | Task manager save | `POST` | `/api/sales/leads/184/task-manager` | Action | 200 | **9.4** | 8.9–14.2 | 8 | 4.3 | 5.1 | 388 B | **~637 est.** | ~628 est. | ~140 est. |
| 14 | WhatsApp status save | `POST` | `/api/sales/leads/184/whatsapp` | Action | 200 | **8.2** | 8.1–8.4 | 7 | 3.8 | 4.4 | 196 B | **~636 est.** | ~628 est. | ~139 est. |

### 1 Inquiry Received

| # | UI action | Method | Endpoint (as the page calls it) | Type | HTTP | Server time ms (median) | Server min–max | DB queries | DB ms | PHP/app ms | Response | Client sees ms, avg (min–max) | Overhead ms (client − server) | With OPcache ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 15 | Save & Next (advance to stage 2) | `PUT` | `/api/sales/leads/184` | Action | 200 | **9.4** | 9.4–9.5 | 7 | 3.8 | 5.6 | 1.2 KB | **~637 est.** | ~628 est. | ~140 est. |

### 2 Lead Acknowledgement

| # | UI action | Method | Endpoint (as the page calls it) | Type | HTTP | Server time ms (median) | Server min–max | DB queries | DB ms | PHP/app ms | Response | Client sees ms, avg (min–max) | Overhead ms (client − server) | With OPcache ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 16 | Ack reason master | `GET` | `/api/sales/lead-ack-reasons?branch_id=3` | Load | 200 | **5.9** | 5.7–6.9 | 5 | 2.5 | 3.4 | 299 B | **523 (453–629)** | 517 | 139 |
| 17 | Submit acknowledgement | `POST` | `/api/sales/leads/184/acknowledgements` | Action | 201 | **10** | 9–10.6 | 9 | 4.4 | 5.6 | 441 B | **~638 est.** | ~628 est. | ~141 est. |
| 18 | Save & Next (advance to stage 3) | `PUT` | `/api/sales/leads/184` | Action | 200 | **9** | 8.6–9.1 | 7 | 3.8 | 5.2 | 1.2 KB | **~637 est.** | ~628 est. | ~140 est. |

### 3 Product Sourcing

| # | UI action | Method | Endpoint (as the page calls it) | Type | HTTP | Server time ms (median) | Server min–max | DB queries | DB ms | PHP/app ms | Response | Client sees ms, avg (min–max) | Overhead ms (client − server) | With OPcache ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 19 | Mapped products | `GET` | `/api/sales/leads/184/products?branch_id=3` | Load | 200 | **9.2** | 8.9–11.7 | 13 | 4.4 | 4.8 | 1.3 KB | **1195 (589–2385)** | 1186 | 191 |
| 20 | Product directory - product master | `GET` | `/api/products?branch_id=3` | Load | 200 | **26** | 24.9–28.1 | 16 | 6.7 | 19.3 | 53.8 KB | **896 (792–1023)** | 870 | 166 |
| 21 | Product directory - currencies | `GET` | `/api/master/currencies?branch_id=3` | Load | 200 | **9** | 8.8–11.5 | 8 | 3.3 | 5.7 | 4.6 KB | **766 (673–805)** | 757 | 128 |
| 22 | Vendor mappings modal | `GET` | `/api/products/81/vendor-maps?branch_id=3` | Load | 200 | **7** | 6.6–8.5 | 6 | 2.7 | 4.3 | 2.1 KB | **612 (576–636)** | 605 | 101 |
| 23 | Map a product | `POST` | `/api/sales/leads/184/products` | Action | 201 | **20.7** | 20.5–22.9 | 20 | 11.2 | 9.5 | 510 B | **~649 est.** | ~628 est. | ~152 est. |
| 24 | Edit mapped product | `PUT` | `/api/sales/leads/184/products/6` | Action | 200 | **9.7** | 9.4–10.1 | 9 | 4.5 | 5.2 | 542 B | **~638 est.** | ~628 est. | ~141 est. |
| 25 | Change sourcing status | `PATCH` | `/api/sales/leads/184/products/6/sourcing-status` | Action | 200 | **7.2** | 7.1–7.6 | 7 | 3.5 | 3.7 | 89 B | **~635 est.** | ~628 est. | ~138 est. |
| 26 | Save & Next (advance to stage 4) | `PUT` | `/api/sales/leads/184` | Action | 200 | **9.2** | 9–9.2 | 7 | 3.9 | 5.3 | 1.2 KB | **~637 est.** | ~628 est. | ~140 est. |

### 4 Price Shared

| # | UI action | Method | Endpoint (as the page calls it) | Type | HTTP | Server time ms (median) | Server min–max | DB queries | DB ms | PHP/app ms | Response | Client sees ms, avg (min–max) | Overhead ms (client − server) | With OPcache ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 27 | Shared prices (all rows) | `GET` | `/api/sales/leads/184/shared-prices?branch_id=3` | Load | 200 | **10.2** | 10.1–10.4 | 9 | 4.9 | 5.3 | 1.2 KB | **647 (602–709)** | 637 | 162 |
| 28 | Price history for one product | `GET` | `/api/sales/leads/184/products/6/shared-prices?branch_id=3` | Load | 200 | **7.9** | 7.5–8.6 | 7 | 3.7 | 4.2 | 194 B | **607 (602–614)** | 599 | 145 |
| 29 | Shared price PDF | `GET` | `/api/sales/shared-prices/5/pdf?branch_id=3` | Load | 200 | **182.3** ⚠ | 167.3–189.4 | 11 | 5.9 | 176.4 | 22 KB | **1153 (1102–1268)** | 971 | 366 |
| 30 | Record quoted price | `POST` | `/api/sales/leads/184/products/6/shared-prices` | Action | 201 | **11.1** | 11–12.5 | 10 | 5.3 | 5.8 | 303 B | **~639 est.** | ~628 est. | ~142 est. |
| 31 | Save & Next (advance to stage 5) | `PUT` | `/api/sales/leads/184` | Action | 200 | **10.2** | 8.4–10.6 | 8 | 3.5 | 6.7 | 1.2 KB | **~638 est.** | ~628 est. | ~141 est. |

### 5 Quotation vs PI

| # | UI action | Method | Endpoint (as the page calls it) | Type | HTTP | Server time ms (median) | Server min–max | DB queries | DB ms | PHP/app ms | Response | Client sees ms, avg (min–max) | Overhead ms (client − server) | With OPcache ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 32 | Quotations for opportunity | `GET` | `/api/sales/quotations?opp_id=184&per_page=200&branch_id=3` | Load | 200 | **11.9** | 11.8–13.2 | 14 | 6.2 | 5.7 | 1.9 KB | **660 (612–761)** | 648 | 168 |
| 33 | PIs for opportunity | `GET` | `/api/sales/proforma-invoices?opp_id=184&per_page=200&branch_id=3` | Load | 200 | **18.2** | 15.9–20.8 | 16 | 9.2 | 9 | 2.4 KB | **646 (627–690)** | 628 | 136 |
| 34 | E-sign status (sync=0) | `GET` | `/api/clm/signature-requests?lead_id=184&document_type=proforma_invoice&sync=0&branch_id=3` | Load | 200 | **6.7** | 6.5–7.6 | 5 | 2.8 | 3.9 | 1.2 KB | **671 (584–715)** | 664 | 124 |
| 35 | PI code preview | `GET` | `/api/sales/proforma-invoices/preview-code?branch_id=3` | Load | 200 | **5.9** | 5.8–6.6 | 5 | 2.7 | 3.2 | 48 B | **663 (562–774)** | 657 | 114 |
| 36 | Sales-doc signer list | `GET` | `/api/clm/signature-requests/sales-doc-signers?doc_kind=proforma_invoice&doc_id=6&branch_id=3` | Load | 200 | **7.7** | 7.6–8.1 | 7 | 3.7 | 4 | 104 B | **679 (606–779)** | 671 | 107 |
| 37 | Convert quotation to PI | `POST` | `/api/sales/proforma-invoices/from-quotation/5` | Action | 201 | **153.6** ⚠ | 143.3–210.9 | 29 | 21.2 | 132.4 | 1.6 KB | **~782 est.** | ~628 est. | ~285 est. |
| 38 | Save & Next (advance to stage 6) | `PUT` | `/api/sales/leads/184` | Action | 200 | **9.5** | 9–9.6 | 7 | 3.8 | 5.7 | 1.2 KB | **~638 est.** | ~628 est. | ~141 est. |

### 6 Victory

| # | UI action | Method | Endpoint (as the page calls it) | Type | HTTP | Server time ms (median) | Server min–max | DB queries | DB ms | PHP/app ms | Response | Client sees ms, avg (min–max) | Overhead ms (client − server) | With OPcache ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 39 | Lead summary | `GET` | `/api/sales/leads/184?branch_id=3` | Load | 200 | **17.2** | 16.1–21.1 | 18 | 9.1 | 8.1 | 3.4 KB | **735 (667–801)** | 717 | 117 |
| 40 | Quotation count | `GET` | `/api/sales/quotations?opp_id=184&per_page=1&branch_id=3` | Load | 200 | **13.9** | 13.6–14.1 | 14 | 7.1 | 6.8 | 1.9 KB | **630 (608–669)** | 617 | 119 |
| 41 | PI count | `GET` | `/api/sales/proforma-invoices?opp_id=184&per_page=1&branch_id=3` | Load | 200 | **12.8** | 12.1–15.2 | 16 | 6.2 | 6.6 | 2.4 KB | **669 (634–734)** | 656 | 132 |
| 42 | Shipment order for lead | `GET` | `/api/sales/leads/184/shipment-order?branch_id=3` | Load | 200 | **9.1** | 8.6–9.5 | 10 | 3.9 | 5.2 | 1.2 KB | **660 (598–745)** | 650 | 145 |
| 43 | Products for lead | `GET` | `/api/sales/leads/184/products?branch_id=3` | Load | 200 | **10.7** | 9.4–11.7 | 13 | 5.6 | 5.1 | 1.3 KB | **787 (512–1278)** | 777 | 149 |
| 44 | Create procurement - salespeople | `GET` | `/api/sales/leads/salespeople?branch_id=3` | Load | 200 | **10.4** | 9.6–12.1 | 10 | 4.5 | 5.9 | 226 B | **509 (473–574)** | 498 | 129 |
| 45 | Create procurement - next number | `GET` | `/api/procurements/next-number?branch_id=3` | Load | 200 | **5.1** | 4.6–5.9 | 5 | 2.3 | 2.8 | 59 B | **463 (435–497)** | 458 | 146 |
| 46 | Procurement details modal | `GET` | `/api/procurements/1?branch_id=3` | Load | 200 | **10.5** | 9.7–11.5 | 12 | 4.7 | 5.8 | 1 KB | **485 (462–500)** | 475 | 123 |
| 47 | Create shipment - next code | `GET` | `/api/sales/shipment-orders/next-code?branch_id=3` | Load | 200 | **5.9** | 5.1–7 | 5 | 2.7 | 3.2 | 32 B | **470 (443–508)** | 464 | 125 |

---

## 5. Findings (verified)

| # | Severity | Finding | Evidence | Fix |
|---|---|---|---|---|
| T-01 | **High (dev / any server without OPcache)** | Every request re-boots Laravel cold: **≈ 400–1,200 ms** per call, which is 95% of what the user waits for. | `/up` (no work) = 0.39–1.25 s on :8000; a plain `<?php echo 1;` = 3 ms; `opcache` not loaded in PHP CLI; only `packages.php` and `services.php` in `bootstrap/cache` (no config/route cache). With OPcache: `/up` drops to 45–86 ms and the API average from 665 → 153 ms. | Enable OPcache in `C:\xampp\php\php.ini` (`zend_extension=opcache`, `opcache.enable=1`, `opcache.enable_cli=1`). In production also run `php artisan config:cache route:cache event:cache` and set `APP_DEBUG=false`. |
| T-02 | **High (dev)** | Parallel stage loads are handled one at a time. Stage 6's five calls take 3.0 s instead of ≈ 0.7 s. | `curl --parallel` of the 5 Stage 6 calls: each response's TTFB is ≈ 0.9 s later than the one before. The built-in PHP server has a single worker on Windows. | For realistic timing, test behind Apache/Nginx + PHP-FPM or Laravel Octane. On Linux/macOS `PHP_CLI_SERVER_WORKERS=4` works with `artisan serve`. |
| T-03 | **Medium** | The KYC vault spends **≈ 120 ms** in PHP on every call, and the page calls it twice (customer + consignee). | Query-gap trace: a **152 ms** gap with no DB activity right after `select id,name from clm_authorities`. Client 1 has **10,039** authority rows; `ClmAuthority::idNameMap()` hydrates every one as an Eloquent model (122 ms; a `pluck('name','id')` of the same data takes 10 ms). | [SegmentDocUploadController.php:423](app/Http/Controllers/Api/SegmentDocUploadController.php#L423): pass the referenced ids (`idNameMap($cid, $ids)`, which the KYC/DD/QC/TL controllers already do), or change [ClmAuthority::idNameMap](app/Models/ClmAuthority.php#L45) to use `pluck('name','id')`. |
| T-04 | **Medium** | The same full-table authority load can repeat once per category inside `missingMandatoryDocs()`, which the Quotation→PI conversion runs for both customer and consignee. | [SegmentDocUploadController.php:2520](app/Http/Controllers/Api/SegmentDocUploadController.php#L2520) calls `fetchMasters(..., null, ...)`, and [line 2711](app/Http/Controllers/Api/SegmentDocUploadController.php#L2711) then reloads `idNameMap($cid)` on each call. The measured conversion (`from-quotation/5`) spent 132 ms in PHP. The worst case grows by ≈ 120 ms for each category that has codes. | Resolve `$authMap` once in `missingMandatoryDocs()` and pass it in (the vault already does this at line 423). |
| T-05 | Low | Shared-price PDF takes ≈ 180 ms server-side (dompdf render, 176 ms PHP / 6 ms DB). | In-process timing #29. | Expected for dompdf. Only matters if the PDF is generated often; could be cached per `shared_price` id. |
| T-06 | Low | Every save triggers a second request (`reloadLead`), doubling the wait. | `SalesMatrixDetail.tsx` `reloadLead()` runs after every stage save (`Stage1InquiryReceived.tsx:54`, `Stage2LeadAcknowledgement.tsx:155,189`, and others). | Return the updated header from `PUT /sales/leads/{id}` and apply it directly. This saves one round trip per save. |
| T-07 | Info | Database time is not a bottleneck anywhere: the highest is 21.6 ms (consignee vault, 25 queries), and the lead header uses 18 queries in 9 ms. | DB columns in §4. | None needed. |

---

## 6. Verification log

| Check | Result |
|---|---|
| API list complete? | Collected from every `api.get/post/put/patch/delete` call in `opportunity-pipeline/matrix/**` (SalesMatrixDetail, Stage1–6, CreateProcurement, CreateShipmentOrder, ProcurementDetails, VendorMappings, ProductDirectory, PriceShared, ProductSourcing, Meetings*, Reminders*, TaskManager, WhatsApp, SalesDocSendForSignature), including multi-line calls. |
| Payloads valid? | Every write returned 200/201. First-pass 422s (meetings `type`, reminders `status`, signers `doc_kind`) and a 409 (quotation 4 already converted) were fixed by matching the real validation rules / using draft quotation 5, then re-measured. |
| Same responses on both servers? | Yes: response size per endpoint was identical on :8000 and :8011 (an earlier invalid OPcache run that returned 718-byte errors was discarded). |
| Data left behind? | None: 0 test meetings, 0 test reminders, quotation 5 still `draft`, no PI on opp 183, lead 184 still stage 6 and its remark unchanged. Benchmark tokens (`name='bench-timing'`) deleted. Test server on :8011 stopped. |
| Machine noise | The dev box slowed down during the session (`/up` went from 0.41 s to 0.75–1.25 s), so "client sees" values vary ±30% between runs. Server-side values were stable (±2 ms). The as-is vs OPcache comparison was run back to back. |

### Not measured (and why)

| Endpoint | Reason |
|---|---|
| `POST /clm/signature-requests/sales-doc-send`, `POST …/{id}/remind`, `GET …/view-file/0`, `GET …/download-file/0` | Call Zoho Sign live. Timing would be Zoho's latency, and would send real e-mails / reminders. |
| `GET /clm/signature-requests?sync=1` | Polls Zoho for each in-progress request (external latency). The `sync=0` variant is measured (#34). |
| `POST /procurements`, `POST /sales/shipment-orders`, `POST/PUT /sales/quotations`, `POST/PUT /sales/proforma-invoices` | Multi-section forms with large payloads (items, costing, documents). Not built for this pass. Their "next number / next code / preview code" calls are measured. |
| `POST /clm/signature-requests/agreement-preview`, `POST /clm/leads/{id}/doc-needs` | Agreement modal. Preview renders DOCX; can be added on request. |

---

## 7. Reproduce

Scripts are in the session scratchpad (not committed): `bench.php` (in-process server timing, writes rolled back) and the curl loops. Rerun them after enabling OPcache to confirm T-01.
