# Dead-Code Report — backend + frontend

**Branch:** `saas` @ `ef82c058` · **Date:** 2026-09-29
**Supersedes** `docs/FRONTEND_DEAD_CODE.md` (frontend only, taken at `b41679c2`, before the last merge).

**Method.** Frontend: import-graph reachability from the single Vite entry (`resources/js/app.tsx`,
per `vite.config.js`). Backend: every class under `app/` checked for a reference outside its own
file; every public controller method checked against `routes/`; every registered API route checked
against the SPA source; every Blade view checked for a render. Everything below was then verified by
hand — the raw scans produced false positives, and those are listed in §6 rather than quietly
dropped.

---

## 1. Headline

| Area | Dead | Notes |
|---|---|---|
| Frontend files | **137 of 562** (~24%) | 111 Velzon theme leftovers, **26 our own** (~6,900 LOC) |
| Backend classes | **0** | nothing under `app/` is unreferenced |
| Backend controller methods | **2** | no route, no caller |
| API routes the SPA never calls | **34** | see §4 — a few are correct, one is a whole unused feature |
| Blade views | **1** | plus 16 framework-owned (§6) |
| CSS files | **0** | all 39 stylesheets are imported |

The backend is in good shape. The frontend carries a quarter of its files unreachable. The single
most valuable finding is not a file at all — it is a **built backend feature with no UI** (§4.1).

---

## 2. Frontend — our own code (26 files, 6,918 LOC)

### 2.1 The old layout system (10 files, ~2,400 LOC) — one dead subsystem

Superseded by the Velzon layout. `layouts/AppLayout.tsx` is a root nobody mounts, and the six
components below are imported **only** by these four files — which is why a naive "is it imported?"
check says they are alive.

| File | LOC |
|---|---|
| `resources/js/layouts/Sidebar.tsx` | 416 |
| `resources/js/layouts/AppLayout.tsx` | 316 |
| `resources/js/layouts/TopNav.tsx` | 299 |
| `resources/js/layouts/Topbar.tsx` | 277 |
| `resources/js/components/ThemeCustomizer.tsx` | 156 |
| `resources/js/components/ui/VelzonCard.tsx` | 130 |
| `resources/js/components/GlobalSearch.tsx` | 118 |
| `resources/js/components/LayoutToggle.tsx` | 55 |
| `resources/js/components/StatCard.tsx` | 50 |
| `resources/js/components/BranchSwitcher.tsx` | 22 |

**Delete as a unit.** Removing any one alone leaves the rest looking referenced.

### 2.2 Superseded pages (4 files, 3,494 LOC)

| File | LOC | Why it is dead |
|---|---|---|
| `pages/clm/document-masters/ClmTradeDocumentDraftPage.tsx` | 1,054 | no importer, no route |
| `pages/sales/opportunity-pipeline/matrix/PriceSharedModal.tsx` | 908 | Stage 4 rebuilt; its API (`sharedPricePdf`) is dead too — §4.3 |
| `pages/sales/opportunity-pipeline/matrix/ProductSourcingModal.tsx` | 822 | Stage 3 rebuilt |
| `pages/vendors/Vendors.tsx` | 710 | orphan of the P2P reorg (`539f3cb3f`); the live copy is `pages/p2p/p2p-master-management/supplier-management/Vendors.tsx`. **It imports a file that no longer exists**, so `tsc` errors on it today |

### 2.3 Superseded master pages (2 files, 1,017 LOC)

| File | LOC |
|---|---|
| `pages/master/CompanyDetails.tsx` | 572 |
| `pages/OrganizationTypes.tsx` | 445 |

`OrganizationTypes.tsx` is still listed as a live page in `CLAUDE.md` §12 and §13 — the doc is out of
date, the route is gone.

### 2.4 Unused shared components (7 files, 552 LOC)

`components/AdvanceSettleModal.tsx` (223), `components/ui/EmployeePicker.tsx` (174),
`components/ui/Table.tsx` (58), `components/ui/Modal.tsx` (38), `components/ui/Loader.tsx` (22),
`components/ui/Avatar.tsx` (18), `components/ui/Card.tsx` (17).

`components/ui/` is an abandoned primitives layer — the app standardised on reactstrap instead.

### 2.5 Loose files

- `resources/js/queryClient.ts` (11) — React Query was never adopted; business state goes through
  Context + Axios.
- `resources/js/bootstrap.js` (4) — Laravel's default file; not imported, not a Vite entry.

---

## 3. Frontend — Velzon theme leftovers (111 files, 25,915 LOC)

Unreferenced demo pages, sample widgets and unused theme layouts under `resources/js/velzon/`.

Safe to delete, but **low value**: it is vendor code nobody edits, and keeping it makes a future
theme upgrade a straight overwrite instead of a merge. Recommend leaving it unless repo size is a
concern.

---

## 4. Backend

### 4.1 An entire feature with no UI — Full & Final settlement

```
GET  /api/payroll/fnf/{employeeId}
POST /api/payroll/fnf/{employeeId}
POST /api/payroll/fnf/{employeeId}/status
```

Zero references anywhere in `resources/js`. The backend is written; nothing can reach it. This is not
code to delete — it is **a feature to finish or formally park**. (Consistent with the known payroll
gap that F&F is not persisted.)

### 4.2 Payroll adjustments — 6 endpoints, no UI

`GET`/`POST /payroll-adjustments`, `DELETE /payroll-adjustments/{id}`,
`POST /payroll-adjustments/{id}/approve`, `.../reject`, `GET /payroll-adjustments/overtime-preview`.

Same situation: a complete approve/reject workflow the app never calls. Note `PayrollService` *reads*
adjustments when pricing a cycle, so the data path matters — only the management UI is missing.

### 4.3 Dead controller methods (2)

| Method | Note |
|---|---|
| `QuotationController::convertToPi` | its route was deliberately removed (`routes/api.php:610` says so) but the method body stayed |
| `SalesLeadController::sharedPricePdf` | no route; its only caller was `PriceSharedModal.tsx`, itself dead (§2.2) |

### 4.4 Other unreferenced endpoints (26)

Grouped by what they most likely mean:

**Test-only, and reachable in production routing** — `POST /dev/attendance-seed`,
`POST /dev/backdate-joining`, `POST /dev/sandwich-leave`. QA seeders any authenticated user can call.
Worth gating or removing; this is a risk, not just clutter.

**Built, never wired** — `/clm/kyc-documents/import`, `/clm/dd-documents/import`,
`/clm/trade-licenses/import` (bulk import), `/attendance/my`, `/holidays/my`, `/subscription/status`,
`/products/owners`, `/hr-custom-fields/validate-tokens`, `/p2p/new-suppliers` and
`/p2p/new-suppliers/{supplier}/sourcings`, `/backup/email/send`, `/backup/email/status`,
`/announcements/next-code`, `/hiring-requests/next-code`, `/recruitments/next-code`.
(`/branches/next-code` *is* used — only these three siblings are not.)

**Payment-proof / Zoho-sync pairs** — `advance-requests/payments/{id}/proof` and `/sync-zoho`,
`expense-claims/payments/{id}/proof` and `/sync-zoho`, plus two P2P refund-adjustment lookups
(`/p2p/orders/refund-adjustments/eligible-pos`, `/po/{po}`).

**Correctly unreferenced** — `POST /razorpay/webhook` is called by Razorpay, not the SPA.

### 4.5 Blade

`resources/views/pdf/partials/sales-doc-tnc-header.blade.php` (38 lines) — no `@include`, no
`view()` call anywhere.

### 4.6 Console commands — dormant, not dead

Laravel auto-discovers these, so "no PHP reference" is expected. Actual status:

| Command | Status |
|---|---|
| `hr:send-probation-emails` | scheduled daily |
| `backup:email` | scheduled daily (self-gates to a real 15-day interval) |
| `subscriptions:send-expiry-reminders` | **schedule commented out** — deliberately parked, and `routes/console.php` says why |
| `payroll:seed-scenarios`, `payroll:verify-scenarios` | QA tools, run by hand |
| `logos:backfill-dark`, `sourcing:backfill-product-names` | one-off backfills, presumably spent |

None of this runs at all unless the OS scheduler invokes `schedule:run`.

---

## 5. Suggested order of removal

1. **`pages/vendors/Vendors.tsx`** — first, because it is the only dead file that actively breaks
   something (a `tsc` error on a missing import).
2. **The layout cluster (§2.1)** — 10 files, one atomic deletion.
3. **`components/ui/` + `queryClient.ts` + `bootstrap.js`** — small and zero-risk.
4. **The superseded pages (§2.2, §2.3)** — confirm with the team first; `ClmTradeDocumentDraftPage`
   at 1,054 LOC may be a parked feature rather than a leftover.
5. **`QuotationController::convertToPi` and `SalesLeadController::sharedPricePdf`.**
6. **Decide on the `/dev/*` routes.**
7. **Raise F&F and payroll adjustments as product questions**, not as cleanup.

Leave the Velzon leftovers unless there is a reason to touch them.

---

## 6. False positives — checked and cleared

These surfaced in the raw scans and are **not** dead:

- `resources/js/vite-env.d.ts` — ambient type declarations, loaded via `tsconfig`, never imported.
- `app/Models/P2p/Supplier.php` — used through an alias (`use … Supplier as P2pSupplier`).
- `app/Models/Concerns/BelongsToTenant.php` — a trait, consumed as `use BelongsToTenant;`.
- 37 of the 39 initially "unrouted" controller methods — the P2P routes alias the controller to a
  local (`$po = PurchaseOrderController::class;` then `[$po, 'method']`), which a naive scan misses.
- 16 `resources/views/vendor/mail/**` templates — Laravel's published mail markdown, rendered by the
  framework rather than by name.
- `POST /razorpay/webhook` — called by Razorpay.
