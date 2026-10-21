# Load Optimization Sheet — Cross_Border_Command

**Date:** 2026-10-21 · **Branch:** `saas` · **Method:** every optimization-labelled commit (Apr → Oct 2026, 61 commits) was diffed and re-verified against the current tree, plus an independent module-by-module sweep of the current code. Read-only audit — no code changed.

**Legend — Impact:** 🟢 High (real, measurable load-time cut) · 🟡 Medium · 🔵 Low · ⚪ None (refactor / cosmetic / perceived-only)
**Verdict:** ✅ Optimized · 🟠 Partially · ❌ Not optimized

---

## 1. Summary

| | Count |
|---|---|
| Optimization-labelled commits checked | 61 |
| Commits with **real** load impact (High/Medium) | 33 |
| Commits that are refactor / comments / CSS-move / skeleton only | 28 |
| Commits reverted or superseded | 5 (0520544f, 8c4acd74-shimmer, 0077fe7f-queue, 6b3c141a-sheen, 92e42835→lazyPage) |
| Frontend routes lazy-loaded | **114 / 114** (`lazyPage()` in [App.tsx](../resources/js/components/App.tsx)) |
| Modules ✅ Optimized | 27 sub-screens |
| Modules 🟠 Partially | 17 sub-screens |
| Modules ❌ Not optimized | 10 sub-screens |

**Important note for QA:** many commits titled "code optimization" (esp. the 2026-06-25 series) are **comment removal / CSS extraction only** — they do **not** make the page load faster. Do not log "no speed change" against those as a bug.

---

## 2. Optimized modules — start to end (module-wise list)

Ordered by product area. Only **real** load-time optimizations are listed here; cosmetic ones are in §3.

### 2.1 Platform / App shell (affects every page)

| # | What was done | Commit | Impact | Evidence |
|---|---|---|---|---|
| P1 | All 114 page routes code-split (`React.lazy` → `lazyPage()` with stale-chunk auto-reload) | 74b9c578, 68b2412c, dd71de4a, 04950cce | 🟢 | App.tsx:25-114, utils/lazyPage.ts |
| P2 | Hashed `/build/assets` served `Cache-Control: immutable, 1 year`; images/fonts 30 days | 04950cce | 🟢 | public/.htaccess:61-71 |
| P3 | Google Fonts made non-render-blocking + preconnect | 04950cce | 🟡 | welcome.blade.php:59-61 |
| P4 | Razorpay checkout.js removed from `<head>`, loaded on demand | 04950cce | 🟡 | PlanSelection.tsx:27,208 |
| P5 | Removed post-login dashboard-stats preload (~110 queries / ~8.5 s on every login) | 8c4acd74 | 🟢 | App.tsx (no client-stats call) |
| P6 | `app.css` was downloaded twice — duplicate import removed | 9289cd27 | 🔵 | app.tsx:1 |
| P7 | Platform settings cached 60 s | — | 🔵 | Support/Settings.php:25 |

### 2.2 SaaS tenancy (Clients / Branches)

| # | Screen | What was done | Commit | Impact | Evidence |
|---|---|---|---|---|---|
| T1 | Client form | 4 GETs → 1 `/clients/form-bundle`; server cache 5 min + sessionStorage; idle prewarm | 2daa1346 | 🟡 | ClientController.php:762-767 |
| T2 | Clients list | List + KPI stats merged in one call (`include_stats=1`) | 2daa1346 | 🔵 | ClientController.php:63 |
| T3 | Client permissions | 3-step waterfall → 2 parallel calls | 2daa1346 | 🟡 | ClientPermissions.tsx:62-64 |
| T4 | Client edit | States embedded in `show()` — removes serial `/master/states` (~1 s on prod) | 0c4bedd0 | 🟡 | ClientController.php:446 |
| T5 | Branch form | 3 GETs → 1 `/branches/form-bundle`, cached 5 min | 2daa1346 | 🟡 | BranchController.php:1607-1613 |

### 2.3 Dashboard

| # | What was done | Commit | Impact | Evidence |
|---|---|---|---|---|
| D1 | Admin + Client stats `Cache::remember` 60 s + sessionStorage cache | 2daa1346 | 🟡 | DashboardController.php:48, 342 |

### 2.4 Sales

| # | Screen | What was done | Commit | Impact | Evidence |
|---|---|---|---|---|---|
| S1 | Customers / Consignees | Routes + heavy modals lazy; 3.7k lines inline CSS → .css | 68b2412c | 🟡 | SalesCustomers.tsx:31-33, SalesConsignee.tsx:33-34 |
| S2 | Customer / Consignee edit | `show()` embeds documents + owners + segment uploads: 4 requests → 1 | 862dbb65 | 🟡 | CustomerController.php:246-320, ConsigneeController.php:129-208 |
| S3 | Customer / Consignee / Vendor pickers | `?light=1` slim list (columns + primary address only) | 2e885964 | 🟢 | CustomerController.php:49, ConsigneeController.php:48 |
| S4 | Lead Worksheet | Server `paginate` (cap 200), sub-select columns, debounce; perf DB indexes on `leads` | 2026_05_30 migration, 51c8bc41 | 🟢 | SalesLeadController.php:246-249 |
| S5 | Quotation / PI (Stage 5) | Master cache 5 min + in-flight dedupe + prewarm; later 11 GETs → 2 bundles (`/sales/qpi/master-bundle`, `/geo-bundle`, was ~7.6 s) | fab3dddd + later | 🟢 | SalesQPI.tsx:2543-2584, routes/api.php:792,795 |
| S6 | Sales Matrix detail | `agreement-applicable?light=1` drops content: 364 KB → ~5 KB per lead | 0ad880f8 | 🟢 | ClmAgreementController.php:456, SalesMatrixDetail.tsx:719 |
| S7 | Lead Evidence Vault | `?docs=1` slim response; per-party session cache (tab switch = 0 requests); Zoho sync call removed | dcea3e18 | 🟢 | SegmentDocUploadController.php:560, LeadEvidenceVaultModal.tsx:145,199-236 |
| S8 | Send-for-signature modal | Preview re-render debounced 600 ms | 0ad880f8 | 🔵 | SalesCustomerSendForSignatureModal.tsx:383-389 |

### 2.5 P2P — Products & Suppliers

| # | Screen | What was done | Commit | Impact | Evidence |
|---|---|---|---|---|---|
| R1 | Add/Edit Product | 8 GETs → 1 `/products/master-bundle`, column trim, cached 5 min | cbca7260 | 🟢 | ProductController.php:1480-1499 |
| R2 | Product edit | QC uploads embedded in `show()` (2 → 1 call) | 9419d674 | 🔵 | ProductController.php:578-601 |
| R3 | Products list | Was `per_page=200` + browser filtering → server paging, server filters, SQL tab counts in same response, debounce | 9335b517 | 🟢 | ProductController.php:69,220,522; Products.tsx:403 |
| V1 | Add/Edit Supplier | 10+ GETs → 1 `/vendors/master-bundle`, cached 5 min, idle prewarm | 4c23bbcc | 🟢 | VendorController.php:2017-2022 |
| V2 | Supplier edit | `show()` bundle (2 → 1) | 862dbb65 | 🔵 | VendorController.php:460,547 |
| V3 | Suppliers list | Server paging + server tab filters | 00ae3376 | 🟡 | Vendors.tsx:696-699 |
| V4 | Suppliers list | 4 modals lazy, Add-wizard hover prefetch, jszip/file-saver (~155 KB) on Export only | 26a88208 | 🟡 | Vendors.tsx:22-28, :866 |
| V5 | Supplier picker (CTC) | `?light=1` skips 9 eager loads + compliance pass (was ~3.7 s) | 2e885964 | 🟢 | VendorController.php:127 |
| O1 | Purchase Orders / SPI / Payment requests / Refunds / GST approval | Server `paginate` + `useServerList` + debounce; PO lookups cached 10 min | (built-in) | 🟢 | PurchaseOrderController.php:292, use-po-lookups.ts:62 |

### 2.6 Inventory

| # | Screen | What was done | Impact | Evidence |
|---|---|---|---|---|
| I1 | Warehouse / Zone / Rack / Flag masters | `paginate` (max 100), lazy modals, debounce, skeleton | 🟡 | BaseInventoryController.php:327-329 |
| I2 | Putaway | Partial indexes for live occupancy / locks / open putaways | 🟡 | 2026_10_14_000008, _000009 migrations |

### 2.7 CLM

| # | Screen | What was done | Commit | Impact | Evidence |
|---|---|---|---|---|---|
| C1 | KYC / DD / QC / Trade Licence | **N+1 fix** — usage check was 182 queries for 20 rows (10–13 s) → built once per request; server paging, SQL search, SQL tab counts | e9a50f9f | 🟢 | ChecksClmDocUsage.php, ClmKycController.php:50-55 |
| C2 | Same pages (frontend) | `per_page` request, 350 ms debounce, stale-response guard, authorities fetched once (`view=options`) | e9a50f9f | 🟢 | ClmKycPage.tsx:37,53,72 |
| C3 | Authority master | `view=options` picker (3.8 MB → few hundred KB), paging, `normalizeIds` token-scoped (~300 ms saved per save) | e9a50f9f | 🟢 | ClmAuthorityController.php:47,62; ClmAuthority.php:161 |
| C4 | Authority master | Usage sets cached 60 s per tenant (33 queries over 8 tables); mount double-fetch removed | 19e62e16 | 🟢 | ClmAuthorityController.php:82,570,582 |
| C5 | DCP + master pages | Add/Edit modals split & lazy — DCP no longer bundles 4 whole pages | 47d4c0f3 | 🟡 | ClmDcpPage.tsx:19-22 |
| C6 | Clause Library / Trade Docs / Clause insert panel | Shared `usePagedList` (server paging + debounce); `view=list` drops `content`; clause panel filtered server-side (was 302 KB) | f00154f8, b9d6066d | 🟡 | clmShared.ts:1707, ClmTradeDocumentController.php:67,231,260 |
| C7 | Agreement / Trade-doc / CTC preview | Preview PDFs cached 10 min (content-hash key) | 0ad880f8 | 🟢 | ClmAgreementController.php:1369, CtcContractController.php:1893 |
| C8 | CTC version download | Rendered PDF file-cached by fingerprint — repeat skips dompdf (was 56.8 s of 57.5 s) | 8c4acd74 | 🟢 | CtcContractController.php:1747-1765 |
| C9 | CTC form | Signature poll 10 s → 20 s, in-flight guard, paused on hidden tab, stops once signed | 0f666543 | 🟡 | ClmCtcForm.tsx:349-361 |
| C10 | Zoho send | Fixed `sleep(1)` → 200 ms poll, 1 s cap | 0ad880f8 | 🟡 | ClmSignatureController.php:3154 |
| C11 | Buyer Profile vault | "Same-as-Customer" consignee skips a fetch | 8c4acd74 | 🔵 | ClmBuyerProfilePage.tsx:737 |

### 2.8 HRMS

| # | Screen | What was done | Commit | Impact | Evidence |
|---|---|---|---|---|---|
| H1 | Employees | Server paging (25, max 200), `view=list` ~36 cols, N+1 ancillary roles batched, manager appends off (~50 queries/page saved), `/employees/stats`, debounce; `show()` 52 → 26 queries | c40e38d1 | 🟢 | EmployeeController.php:78,384,562,1094 |
| H2 | Employee wizard | Skip PUT on unchanged Save & Next | 6b3c141a | 🔵 | HrEmployees.tsx:2938-2993 |
| H3 | Exit Management | Own paged `view=exit`, batched roles/assets, SQL tab filters, `exit-stats` (was whole roster) | 48fe3955 | 🟢 | EmployeeController.php:143,600,633,943 |
| H4 | Exit wizard | Holiday-group counts via `withCount` (N+1), `direct-reports?count_only=1`, skip unchanged stage saves | e3bf1fa0 | 🟡 | HolidayGroupController.php:37, ExitController.php:584 |
| H5 | Employee Onboarding | Paged `view=onboarding`, `onboarding-stats`, `onboarding-form-bootstrap` (lookups in 1 call), debounce | 8d785989 | 🟢 | EmployeeController.php:225,833,889,923 |
| H6 | Payroll run | Schema checks memoised, PT slabs + holiday calendar cached per run: **378 → 187 queries** (13 employees) | 62711877 | 🟢 | PayrollService.php:51-61,3349,4132 |
| H7 | Holidays | Server paging + SQL filters, year options in same response, group COUNT N+1 removed (26 q/page) | 698bfdff | 🟢 | HolidayController.php:37,88-116 |
| H8 | Expense Management | Claims paged + KPI/summary in same response; advances ledger N+1 (**1,207 → 1 query**); modals + recharts + xlsx lazy; images 1.1 MB → 47 KB, 835 KB → 228 KB | 9289cd27 | 🟢 | ExpenseClaimController.php:204,271; AdvanceRequestController.php:149,1976 |
| H9 | Broadcast Centre | Server paging + server search; high-priority count in `/stats` | cf880190 | 🟡 | AnnouncementController.php:45,80,156 |
| H10 | Recruitment / Candidates | `paginate`, lazy routes, masters cached per branch | dd71de4a + later | 🟡 | RecruitmentController.php:81, HrRecruitment.tsx:2012 |
| H11 | Leave approvals | Server paging + debounce | — | 🟡 | LeaveRequestController.php:752-768 |
| H12 | Generate Document | N previews → 1 preview for the picked recipient | 20195173 | 🔵 | GenerateDocument.tsx:1160-1212 |
| H13 | Public onboarding submit | Welcome mail moved out of the DB transaction (shorter row lock) | 0077fe7f | 🔵 | OnboardingController.php:328-345 |

### 2.9 Masters, Gmail, cross-cutting

| # | Screen | What was done | Commit | Impact | Evidence |
|---|---|---|---|---|---|
| M1 | MasterPage | Opt-in paging (max 200), column list; `?fields=id,name` for dropdowns; `/master/bulk` (≤20 keys) | c40e38d1 + later | 🟡 | MasterController.php:289,342-348,356-428 |
| M2 | All master bundles | `MasterBundleCache` version key — a master edit busts every cached bundle | — | 🟡 | Support/MasterBundleCache.php |
| G1 | Gmail module | `paginate`, `LIST_COLUMNS`, 160-char snippet | — | 🟡 | EmailController.php:65,116-119 |
| X1 | EmailGuard (duplicate-email check on saves) | 5 schema queries → 1, memoised (6.8 ms → 0.56 ms) | 87ce76d0 | 🔵 | Support/EmailGuard.php:49-68 |

---

## 3. Full commit register (every commit checked)

| # | Commit | Date | Module | Real work | Technique | Present? | Impact |
|---|---|---|---|---|---|---|---|
| 1 | 0520544f | 04-23 | Clients/Branches/Payments | Page size 15 → 10 | UI page size | **No** — now `per_page=9999` | ⚪ |
| 2 | 114e25c3 | 05-27 | CLM KYC | 2-line comment removed | — | n/a | ⚪ |
| 3 | fab3dddd | 05-27 | Sales QPI | Master cache + prewarm + trim | FE cache | Yes (improved) | 🟢 |
| 4 | 4c23bbcc | 05-27 | Suppliers | Master bundle | Bundle + cache | Yes | 🟢 |
| 5 | cbca7260 | 05-27 | Products | Master bundle | Bundle + cache | Yes | 🟢 |
| 6 | 2daa1346 | 05-28 | Clients/Branches/Dashboard | Form bundles, stats cache, parallel perms | Bundle + cache | Partial (login prewarm removed) | 🟡 |
| 7 | 862dbb65 | 05-30 | Customer/Consignee/Supplier | `show()` bundles | Round-trip cut | Yes | 🟡 |
| 8 | 9419d674 | 05-30 | Products | `show()` embeds QC uploads | Round-trip cut | Yes | 🔵 |
| 9 | 0c4bedd0 | 05-30 | Clients | States embedded | Waterfall removal | Yes | 🟡 |
| 10 | 0077fe7f | 06-08 | Onboarding / Lead Ack | Mail out of transaction; skeleton | I/O move | Partial (queue reverted) | 🔵 |
| 11 | d6cc1e12 | 06-11 | CLM masters | Auto-fit rows per page | UI only | Yes | ⚪ |
| 12 | 5b57fd57 | 06-13 | CLM masters | Shared pager component | Refactor | Yes | ⚪ |
| 13 | f64d61eb | 06-23 | Suppliers | CSS / +N popup | UI only | n/a | ⚪ |
| 14 | 68b2412c | 06-24 | Customers/Consignee/Todo | Lazy routes + modals, CSS extracted | Code split | Yes | 🟡 |
| 15 | dd71de4a | 06-24 | Recruitment | Lazy routes | Code split | Yes | 🔵 |
| 16 | 04950cce | 06-24 | Platform | HTTP caching, fonts, Razorpay deferred, lazy | HTTP cache + split | Yes | 🟢 |
| 17 | 0950cea6 | 06-25 | HR Overview | CSS extraction, unused deps | Refactor | Partial | ⚪ |
| 18 | 475f0d10 | 06-25 | Recruitment/Candidates | Comments, 1 unused fetch | Cleanup | Yes | ⚪ |
| 19 | 2ee0332e | 06-25 | Exit | Dead mocks, 1 fetch removed | Cleanup | Yes | 🔵 |
| 20 | 969a8929 | 06-25 | Payroll | CSS/comments + feature | Refactor | Yes | ⚪ |
| 21 | 0407dc37 | 06-25 | Attendance | Dead mock data | Cleanup | Yes | ⚪ |
| 22 | d4588949 | 06-25 | Leave | Comments only | — | Yes | ⚪ |
| 23 | 387c9435 | 06-25 | Holiday | Comments only | — | Yes | ⚪ |
| 24 | 57edb8ac | 06-25 | Expenses | CSS, 1 fetch removed | Cleanup | Yes | 🔵 |
| 25 | c40e38d1 | 08-18 | Employees + Masters | Paging, trim, N+1, stats | Full stack | Yes | 🟢 |
| 26 | 1574e34e | 08-19 | Dev Tools | Performance Lens profiler | Tool | Yes | ⚪ (measures) |
| 27 | 62711877 | 08-20 | Payroll | 378 → 187 queries | Memo cache | Yes | 🟢 |
| 28 | da4703b4 | 08-20 | Employee profile | Skeleton | Perceived | Yes | ⚪ |
| 29 | 6b3c141a | 08-20 | Employee wizard | Skip unchanged save; playbook doc | Request avoidance | Partial (sheen gone) | 🔵 |
| 30 | 74b9c578 | 08-21 | Platform | All routes `React.lazy` | Code split | Yes (→ lazyPage) | 🟢 |
| 31 | 48fe3955 | 08-21 | Exit | Paged exit view + stats | Full stack | Yes | 🟢 |
| 32 | e3bf1fa0 | 08-22 | Exit / Holiday groups | withCount, count_only | N+1 fix | Yes | 🟡 |
| 33 | 8d785989 | 08-22 | Onboarding | Paged view + stats + bootstrap | Full stack | Yes | 🟢 |
| 34 | 4879d9b0 | 08-26 | Seeders | Demo master rows dropped | Seed cleanup | Yes | ⚪ |
| 35 | 9335b517 | 09-02 | Products | Server paging/filters/counts | Pagination | Yes | 🟢 |
| 36 | 00ae3376 | 09-02 | Suppliers | Server paging; CSS move | Pagination | Yes | 🟡 |
| 37 | 26a88208 | 09-02 | Suppliers | Lazy modals + prefetch | Code split | Yes | 🟡 |
| 38 | 5dabfaef | 09-03 | Products | Dead Quality-step UI removed | Cleanup | Yes | ⚪ |
| 39 | 87ce76d0 | 09-08 | EmailGuard | 5 → 1 queries | Memo | Yes | 🔵 |
| 40 | 698bfdff | 09-08 | Holidays | Paging + N+1 | Full stack | Yes | 🟢 |
| 41 | 9289cd27 | 09-08 | Expenses | Paging, N+1, lazy, images | Full stack | Yes | 🟢 |
| 42 | cf880190 | 09-08 | Announcements | Paging | Pagination | Yes | 🟡 |
| 43 | 0ad880f8 | 09-08 | CLM / Sales | light payload, PDF cache, Zoho wait | Trim + cache | Yes | 🟢 |
| 44 | 7950a818 | 09-09 | Agreement send popup | Skeleton | Perceived | Yes | ⚪ |
| 45 | f00154f8 | 09-11 | Clause Library | Paging + debounce | Pagination | Partial (FE → usePagedList) | 🟡 |
| 46 | 2e885964 | 09-11 | CTC Counter Party picker | `?light=1` ×3 | Trim | Yes | 🟢 |
| 47 | b9d6066d | 09-11 | CLM clauses/trade docs | usePagedList, `view=list` | Pagination + trim | Yes | 🟡 |
| 48 | 2658b47f | 09-11 | — | Merge commit | — | n/a | ⚪ |
| 49 | dcea3e18 | 09-11 | Lead Evidence Vault | `docs=1`, session cache | Trim + cache | Yes | 🟢 |
| 50 | e9a50f9f | 09-12 | CLM masters + Authority | N+1, paging, options view | Full stack | Yes | 🟢 |
| 51 | 47d4c0f3 | 09-12 | CLM DCP | Lazy modals | Code split | Yes | 🟡 |
| 52 | 19e62e16 | 09-12 | CLM Authority | Usage cache 60 s | Server cache | Yes | 🟢 |
| 53 | 0013417b | 09-12 | CLM Authority | Delete-guard correctness | Bug fix | Yes | ⚪ |
| 54 | 8c4acd74 | 09-13 | CTC / App shell | PDF file cache, preload removed | Cache + cut | Partial (shimmer reverted) | 🟢 |
| 55 | 51c8bc41 | 09-13 | Lead Worksheet | Skeletons; 1 extra request removed | Perceived | Yes | 🔵 |
| 56 | 92e42835 | 09-13 | Platform | Chunk retry + error boundary | Reliability | Partial (→ lazyPage) | ⚪ |
| 57 | 0f666543 | 09-13 | CTC form | Poll throttle | Request cut | Yes | 🟡 |
| 58 | 16b9d006 | 09-30 | Employee Evidence Vault | Skeleton | Perceived | Yes | ⚪ |
| 59 | 20195173 | 09-30 | Generate Document | Crash fix, 1 preview | Bug fix | Yes | 🔵 |
| 60 | f89cf8fc | 10-07 | Products | Dead code / comments | Cleanup | Yes | ⚪ |
| 61 | a4364157 | 10-08 | Suppliers | Comments only (374 lines) | — | Yes | ⚪ |

---

## 4. Current-code coverage matrix (all modules)

"Lazy route" = Yes for every module (114/114), so that column is omitted.

| Module | Sub-screen | Server paging | Cache | Debounce | Skeleton | Verdict |
|---|---|---|---|---|---|---|
| Sales | Customers | Supported but **page never sends `per_page`** | bundle | Yes | Yes | 🟠 |
| Sales | Consignees | **None** (full `get()` + 4 relations) | bundle | Yes | Yes | ❌ |
| Sales | Lead Ack Master | None (small) | — | No | Yes | 🟠 OK |
| Sales | Lead Worksheet | Yes (cap 200) | — | Yes | Yes | ✅ |
| Sales | Quotation / PI | Yes, but FE asks 200 & pages in browser | FE 5 min | Yes | Yes | 🟠 |
| Sales | Procurement | **None** | — | — | — | ❌ |
| Sales | Shipment orders | **None** | — | Yes | No | ❌ |
| Sales | To-do | **None** | — | Yes | No | ❌ |
| Sales | Matrix detail | n/a | QPI prewarm | — | Yes | 🟠 |
| P2P | SPI / invoices | Yes (max 100) | — | Yes | Yes | ✅ |
| P2P | Purchase orders | Yes | lookups 10 min | Yes | Yes | ✅ |
| P2P | Payment requests / Refunds / GST | Yes | — | Yes | Yes | ✅ |
| P2P | Bulk sourcing | **None** | — | No | No | ❌ |
| P2P | Products | Yes (cap 200) | bundle | Yes | Yes | ✅ |
| P2P | Suppliers | Yes (**no upper cap**) | bundle | Yes | Yes | ✅ |
| Inventory | Warehouse/Zone/Rack/Flag | Yes (max 100) | — | Yes | Yes | ✅ |
| Inventory | Putaway / boxes / tasks | None (indexes exist) | — | No | No | 🟠 |
| CLM | KYC / DD / QC / TL | Yes | — | Yes | Yes | ✅ |
| CLM | Authorities | Yes | 60 s | Yes | Yes | ✅ |
| CLM | Segments / Clauses / Trade docs | Yes | — | Yes | Yes | ✅ |
| CLM | Agreements | **None** (full bodies) | — | No | Yes | ❌ |
| CLM | T&C | **None** | — | No | Yes | ❌ |
| CLM | DCP | None (bootstrap returns all) | — | No | Yes | 🟠 |
| CLM | Signatures | Hard `limit(200)` | logo/PDF | — | — | 🟠 |
| CLM | Buyer / Supplier profile | **None** (aggregate) | — | — | Yes/No | ❌ |
| HRMS | Employees | Yes | — | Yes | Yes | ✅ |
| HRMS | Onboarding / Exit | Yes | — | Yes | Yes | ✅ |
| HRMS | Attendance daily view | None (all employees per date) | — | No | Yes | 🟠 |
| HRMS | Leave requests (My Leave) | None | — | Yes | Yes | 🟠 |
| HRMS | Leave approvals | Yes | — | Yes | Yes | ✅ |
| HRMS | Leave plans | None (small) | — | Yes | Yes | 🟠 OK |
| HRMS | Expense claims | Yes (cap 200) | — | Yes | Yes | ✅ |
| HRMS | Advances | None (N+1 fixed) | — | Yes | Yes | 🟠 |
| HRMS | Payroll | Bounded per period | per-run memo | Yes | Yes | 🟠 |
| HRMS | Recruitment / Candidates | Yes | masters | Yes | Yes/No | ✅ |
| HRMS | Hiring requests | None | — | — | — | 🟠 |
| HRMS | Holidays / Announcements | Yes | — | No | No | ✅ |
| HRMS | HR doc templates / generated docs | None | — | No | Yes | 🟠 |
| Masters | MasterPage | Yes (max 200) | version-busted bundles | Yes | Yes | ✅ |
| Billing | Plans | None (small) | — | — | Yes | OK |
| Billing | Payments | `per_page` no cap; **FE sends 9999** | — | No | Yes | ❌ |
| Tenancy | Clients / Branches | Server supports it; **FE sends 9999** | form-bundle | No | Yes | 🟠 |
| Dashboard | Admin / Client | Aggregates | 60 s | — | Yes | ✅ |
| Dashboard | Employee | Aggregates | **Not cached** | — | Yes | 🟠 |
| Gmail | Mail list | Yes | — | Yes | Yes | ✅ |

---

## 5. NOT optimized / remaining slow spots (ticket candidates)

| # | Area | Problem | Evidence | Priority |
|---|---|---|---|---|
| N1 | Sales > Consignees | Full table + 4 eager relations incl. all addresses; page also loads all customers | ConsigneeController.php:53-69; SalesConsignee.tsx:226,376 | High |
| N2 | Sales > Customers | Server paging exists but page never sends `per_page` → full list | SalesCustomers.tsx:353; CustomerController.php:206 | High |
| N3 | Billing > Payments, Clients, Branches | `per_page=9999` → whole table, browser paging; Payments has no server cap | Payments.tsx:95,184; Clients.tsx:57; Branches.tsx:42; PaymentController.php:57 | High |
| N4 | `/employees` without `view=` | Full roster (~417 rows, 1.6 MB, 68 queries) still used by 7 callers | BatchPaymentModal.tsx:81, GenerateDocument.tsx:186, HrBroadcastCentre.tsx:578, HrCandidates.tsx:1328, HrRecruitment.tsx:2225, EmployeeProfile.tsx:1973, HrEmployeeOnboarding.tsx:2744 | High |
| N5 | CLM > Agreements, T&C | Unpaged, returns full document bodies | ClmAgreementController.php:249-277; ClmTncController.php:92-107 | High |
| N6 | Sales > Procurement, Shipments, To-do; P2P Bulk sourcing | Unpaged `get()` | ProcurementController.php:184-203; ShipmentOrderController.php:366-460; SalesTodoController.php:54,184; SourcingController.php:97-117 | Medium |
| N7 | CLM > DCP bootstrap | Returns all KYC/DD/TL/QC + authorities; next-code uses `length + 1` (wrong if codes have gaps) | ClmDcpPage.tsx:193,204,1084-1105 | Medium |
| N8 | CLM > KYC/DD/QC/TL usage scan | Uncached; runs `Schema::has*` + reads every rule JSON on every list call | ChecksClmDocUsage.php:90,99,127 | Medium |
| N9 | CLM > Clause Library | Every request scans all CTC contracts + versions (`chunkById(25)`), sets memory_limit 512M | ClmClauseController.php:214,276-282 | Medium |
| N10 | Dashboard > Client stats | Cold call ~110 queries; 60 s TTL means most visits miss | DashboardController.php:348+ | Medium |
| N11 | HRMS > Payroll | Still ~14 queries per employee (salary structure, adjustments, attendance, leave, advances not batched) | PayrollService.php | Medium |
| N12 | PDF preview cache | Base64 PDFs up to ~6.7 MB written to the DB `cache` table (`CACHE_STORE=database`); key includes date, so all cold daily | ClmAgreementController.php:1369; .env:50 | Medium |
| N13 | Onboarding submit | Still waits on SMTP (no queue worker); stale "QUEUED" comment | OnboardingController.php:335,345 | Low |
| N14 | Advances, Leave requests, Hiring requests, HR docs, Attendance daily view | Unpaged lists | AdvanceRequestController.php:147; LeaveRequestController.php:70; HiringRequestController.php:88-122; AttendanceController.php:716 | Low–Medium |
| N15 | Missing `per_page` caps | A client can ask for unlimited rows | AttendanceController.php:489; VendorController.php:354; PaymentController.php:57 | Low |
| N16 | Lead Worksheet / Meetings modal | `SKELETON_MIN_MS = 450` holds skeleton ≥ 450 ms even when data is faster | SalesLeadWorksheet.tsx:283; MeetingsListModal.tsx:64 | Low |
| N17 | Search | `ilike '%x%'` across joins; no trigram indexes on PostgreSQL | Employees, Vendors, CLM search | Low |
| N18 | Build | No `manualChunks` vendor split in vite.config.ts | vite.config.ts | Low |
| N19 | Opt-in paging | Employees/CLM/Masters return the whole table if a new caller forgets `per_page` | EmployeeController.php index | Low |
| N20 | Orphan file | `resources/js/pages/vendors/Vendors.tsx` is not routed, imports missing files, adds TS errors | — | Low |
| N21 | HrRecruitment | `/master/departments` fetched twice | HrRecruitment.tsx:896,2222 | Low |

---

## 6. Reference

### 6.1 Server caches (`Cache::remember`)
Customer / Product / Vendor master bundles (5 min, version-busted) · Client & Branch form bundles (5 min) · Admin & Client dashboard stats (60 s) · CLM authority usage (60 s) · Platform settings (60 s) · Sales PDF asset URIs (1 day) · Inline images (1 h) · Zoho Books tax/currency/bank/org maps (30 min – 6 h) · Vendor Zoho currency (30 min). PDF preview bytes use `Cache::get/put` (10 min). CTC version PDFs use a file cache on the `local` disk.

### 6.2 Frontend caches
sessionStorage bundle caches (5 min): customer, product, vendor, client-form, branch-form — cleared by `utils/bustMasterBundles.ts`. Module caches: SalesQPI (5 min/branch), PO lookups (10 min), Recruitment masters (per branch). Shared hooks: `useServerList`, `useDebouncedValue`, `usePagedList` (CLM).

### 6.3 Performance DB indexes
`2026_05_22_000010` customers · `2026_05_30_000200` leads + shared prices · `2026_09_08_000001` lower(email) · `2026_10_14_000008/9` putaway partial indexes · single-column filter indexes on email_logs, payslips, shipment_orders, clm_signature_requests.

### 6.4 How QA can measure (Dev Tools → Performance Lens)
- Screen: Dev Tools → Load Testing ([LoadTesting.tsx](../resources/js/pages/dev-tools/LoadTesting.tsx)). Local/staging only.
- Response headers per API call: `X-Profile-Total-Ms`, `X-Profile-Query-Ms`, `X-Profile-Queries`, `X-Profile-Memory-Kb`. It flags a likely N+1 when there are ≥ 8 queries and the queries-to-rows ratio is > 0.5.
- Add `X-Profile-Rollback: 1` to profile a save without keeping the data.
- **Coverage gap:** the catalogue only covers Employees, Recruitment, Onboarding, Exit and Expenses. For other modules, use the browser Network tab: check request count, payload size, and that `per_page` is in the query string.

### 6.5 Quick QA verification checklist (per optimized screen)
1. Network tab: the list call carries `page` and `per_page`, and the response has `total`/`meta`.
2. Change page or search: one request each time, fired about 350 ms after typing stops (debounced).
3. Open the Add/Edit modal twice within 5 min: the second open sends **no** master-bundle request (cached).
4. Hard reload: `/build/assets/*.js` show `immutable` caching, and the second load serves them from cache.
5. Opening a page downloads only that page's chunk, not the whole app.
6. Edit a master value, then reopen a form: the bundle is fetched again (version bust works).
