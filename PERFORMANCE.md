# IDIMS Performance Playbook

**Cross Border Command — Engineering Reference**

The optimisation techniques in use across the Laravel API and the React SPA: what each one does, the measurement that justified it, and where it lives in the codebase.

| Figure | Meaning |
|---|---|
| 56 / 95 | API controllers using database transactions |
| 5 | Form-bundle caches, client side |
| 108 | Lazily-loaded routes |
| 213 | Build chunks produced from them |

---

## 1. Precondition — measure before changing anything

Every technique below was justified by a number, not a hunch. Two tools produce those numbers, and both are already wired into the app.

### 1.1 Per-request profiler

`ProfileRequest` middleware is opt-in: it does nothing unless the caller sends `X-Profile: 1`, so normal traffic pays no cost. When asked, it turns on the query log and reports back through response headers — total time, database time, **statement count** (the N+1 signal), peak memory, and an id to fetch the full SQL list afterwards.

Headers rather than a wrapper envelope, deliberately: the response body stays byte-identical to a normal call, so what Load Testing measures is exactly what the real screen receives.

*Where:* `app/Http/Middleware/ProfileRequest.php` · Dev Tools → Load Testing

### 1.2 Telescope

Records every query, request and exception in local development. Its Queries tab is how you attribute a slow endpoint to specific SQL, and how you trace a mutation back to the request that issued it.

**Pause it before timing anything.** Telescope writes a row per query into a table that grows into six figures, so leaving it on inflates the very numbers you are trying to read.

*Where:* `php artisan telescope:pause` · `/telescope`

> **Local caveat.** `php artisan serve` is single-threaded — it handles one request at a time, so a page firing five API calls waits five times the framework boot. A staircase waterfall in DevTools is usually this, not your code. Measure production behaviour behind a real web server.

---

## 2. Reduce requests — collapse round-trips

A form that opens with four sequential fetches pays the framework boot four times before the user sees a field. Bundle endpoints return everything one screen needs in a single call.

### 2.1 Master-bundle endpoints

Each heavy form has one endpoint returning every dropdown payload it needs. The Client form's bundle replaces four separate calls — organisation types, plans, countries and states — and folds in the dependent state list so selecting a country needs no follow-up request.

| Before | After |
|---|---|
| 4 round-trips | 1 round-trip |

*Where:* `/products/master-bundle` · `/vendors/master-bundle` · `/customers/master-bundle`

### 2.2 Embedded sub-resources

Where a detail screen always needs a related collection, the parent's `show` response carries it inline instead of the client chasing it. The supplier form previously fired `GET /segment-uploads/supplier/{id}` as a second call on every edit-mode open.

Each embed is wrapped in its own try/catch, so one inner failure — a fresh record with zero uploads, say — cannot break the whole response.

| Before | After |
|---|---|
| 2 round-trips | 1 round-trip |

*Where:* `VendorController::show` · `CustomerController::show` · `ConsigneeController::show`

---

## 3. Reduce payload — send only what the screen renders

A list endpoint that returns full records with every relation attached is shipping a detail payload to render a table. Three techniques keep responses proportional to what is on screen.

### 3.1 Server-side pagination

The page, page size, search term and every active filter go to the API, which returns one page plus a total. The alternative — fetching a large ceiling and filtering in the browser — fails twice: it ships the whole table to render ten rows, and any tenant past the ceiling silently loses the remainder.

Moving pagination to the server means moving the **filters** with it. Filtering a single page client-side would report a total of twelve and then render three.

| Before (111-row tenant) | After |
|---|---|
| 297 queries · 533 KB | 1 page per request |

*Where:* `HrEmployees.tsx` · `Vendors.tsx` · `EmployeeController::index` · `VendorController::index`

### 3.2 Lean response modes

The same endpoint serves a heavy detail shape and a light list shape. `?lite=1` on products skips ten relations — including the vendor-map and QC-record fan-outs — and returns only the six fields a picker reads. `?view=list` on employees trims the row to the eleven columns the table renders.

The wizard fetches its own full record, so nothing on the list path needs the rest.

| Before (full shape) | After (`lite=1`) |
|---|---|
| ~5s load | Under 1s |

*Where:* `ProductController::index` · `EmployeeController::LIST_COLUMNS`

### 3.3 Column-limited eager loads

Relations are loaded with an explicit column list — `'vendorType:id,name'`, `'segments:id,name'` — rather than whole rows. On a list that eager-loads eight relations across a page of records, the difference is most of the payload.

Counts use `withCount` instead of loading the collection to call `count()` on it — currently in twelve controllers.

*Where:* `VendorController::index` · `CustomerController::index` · `AttendanceController`

---

## 4. Reduce queries — stop the same question being asked twice

Query count is the metric the profiler surfaces first, because it is where an endpoint quietly degrades as relations are added.

### 4.1 Resolve once

`EmployeeController::show` resolved the id, fetched the row with its relations, ran the authorisation check, then did all three again through a helper — two identical loads of the record and its two dozen relations, plus a second decrypt of the id, for one GET.

The check that was kept is the cheaper of the two and enforces exactly the same rule: an employee may always read their own profile without the module grant; anyone else's needs `can_view`.

| Before | After (nothing else changed) |
|---|---|
| 52 queries | 26 queries |

*Where:* `EmployeeController::show`

### 4.2 N+1 elimination

Attendance resolves each employee's shift window from the branch that holds the shift timings, so both are eager-loaded rather than paying a lookup per row. Leave groups are loaded once per request and keyed. Agreement existence checks are batched instead of running per row.

The signal to look for is `X-Profile-Queries` scaling with the row count rather than staying flat.

*Where:* `AttendanceController` · `ClmAgreementController`

---

## 5. Reduce repeat work — cache the parts that rarely change

Master data — risk levels, segments, designations, countries — changes rarely and is read constantly. It is cached on both sides, with a deliberate answer to the staleness that creates.

### 5.1 Server cache with a version stamp

Bundles are cached per user for five minutes. The problem that creates: when a master row is added, every user's cached bundle is stale until its TTL lapses, so the new entry does not appear in dropdowns for up to five minutes.

Enumerating and forgetting every per-user key is impossible on the file and database cache drivers — no tag support. Instead a monotonic version number is folded into each cache key. Bumping it on any master write **orphans every key at once**; they expire naturally and the next request recomputes. One rebuild per user per bundle, not a recompute per request.

*Where:* `app/Support/MasterBundleCache.php`

### 5.2 Client mirror in sessionStorage

The frontend keeps its own copy of each bundle for the tab's lifetime, so reopening a form within a session costs no request at all. Five of these exist, one per heavy form.

*Where:* `clientFormBundleCache` · `branchFormBundleCache` · `productBundleCache` · `vendorBundleCache` · `customerBundleCache`

---

## 6. Reduce delivery — ship less JavaScript up front

The SPA is split at every route boundary, so opening the app downloads the shell and one page rather than all of them.

### 6.1 Route-level code splitting

Every page is a dynamic import. Vite cuts a chunk at each one, which is how 108 route definitions become a build of 213 chunks — page chunks plus the shared component and vendor chunks factored out of them.

The distribution is lopsided and worth knowing: **149 of the 213 chunks are under 50 KB**, while the largest six account for roughly a third of the total. Optimisation effort belongs on the monsters, not the long tail.

*Where:* `resources/js/components/App.tsx`

### 6.2 Prefetch, deliberately off

`laravel-vite-plugin` can inject a prefetch link for every build chunk so navigations feel instant. With 100+ route chunks that means downloading pages nobody opens, competing for bandwidth with the API calls the current screen actually needs. It is disabled.

The targeted alternative — starting a route's import on link hover, roughly 300 ms before the click — gets the same feel for one chunk instead of two hundred.

*Where:* `vite.config.ts` · `prefetch: false`

---

## 7. Reduce perceived time — make the wait legible

Some of what reads as slowness is not duration but uncertainty. These techniques change nothing about how long a request takes.

### 7.1 Skeletons shaped like the page

Loading states are built from the real section components, so the card chrome, headings and grid are drawn immediately and only the values shimmer. What arrives is the same layout with data filled in, and nothing shifts.

A generic skeleton is worse than none when it promises the wrong shape — the page visibly rebuilds itself as the placeholder is replaced.

*Where:* `components/ui/Shimmer.tsx` · `RouteFallback` in `App.tsx`

### 7.2 Two counter-intuitive delays

A skeleton that flashes for 40 ms on a cached response reads as a glitch, so the route fallback holds at zero opacity for 180 ms before fading in — a warm navigation shows nothing at all. Form shimmers have a matching 350 ms floor.

Search inputs that hit the API are debounced 350 ms, turning a burst of keystrokes into one request.

*Where:* `RouteFallback` 180 ms · `minShimmerMs` 350 ms · search debounce 350 ms

> **Watch for.** React will not re-show a fallback for a Suspense boundary that has already revealed content — during a navigation it keeps the previous page on screen instead. A single boundary wrapping every route therefore never shows a loading state after the first page. Keying the boundary by pathname makes each route a fresh boundary, which does.

---

## 8. Reference — where each technique lives

Use this to find a working example before applying a technique somewhere new.

| Technique | Implemented in | What it does |
|---|---|---|
| Request profiler | `app/Http/Middleware/ProfileRequest.php` | Opt-in per-request timing, query count and memory via response headers |
| Dev-tool guard | `app/Http/Controllers/Concerns/GuardsDevTooling.php` | Shared environment, role and tenant gate for the `/dev` test-data endpoints |
| Bundle endpoint | `ClientController::formBundle` | Four master round-trips collapsed into one, states included |
| Bundle endpoint | `ProductController` · `VendorController` · `CustomerController` | `/master-bundle` per heavy form |
| Server cache | `app/Support/MasterBundleCache.php` | Per-user 5-minute cache, version-stamped keys for instant invalidation |
| Client cache | 5 × `*BundleCache.ts` | sessionStorage mirror of each form bundle |
| Embedded sub-resource | `VendorController::show` | Segment uploads inlined; second round-trip removed |
| Resolve once | `EmployeeController::show` | Duplicate row + relation load removed — 52 queries to 26 |
| Server pagination | `EmployeeController::index` · `HrEmployees.tsx` | page, per_page, search and filters on the API; returns one page + total |
| Server pagination | `VendorController::index` · `Vendors.tsx` | Replaces a `per_page=200` ceiling; search, scope and tab filters all move server-side (§9) |
| Lean response | `ProductController::index` `?lite=1` | Skips ten relations for the picker path |
| Lean response | `EmployeeController` `?view=list` | Trims the row to the eleven rendered columns |
| Stale-response guard | `Vendors.tsx` `reqRef` | Request token discards a slow fetch that lands after a newer one |
| Search debounce | `Vendors.tsx` · `HrEmployees.tsx` | 350 ms pause before the API call, so typing is one request not eight |
| CSS out of JS | `add-vendor-modal.css` | 111 KB template literal → a real stylesheet Vite minifies, hashes and loads in parallel |
| Column-limited loads | Across list endpoints | `'relation:id,name'` rather than whole related rows |
| withCount | 12 API controllers | Counts without materialising the collection |
| N+1 removal | `AttendanceController` · `ClmAgreementController` | Eager-loaded shift windows, batched existence checks |
| Code splitting | `resources/js/components/App.tsx` | 108 lazy routes → 213 build chunks |
| Lazy modals | `Vendors.tsx` | Wizard, vault, scope gate and jszip moved behind the click — 428 KB → 70 KB at page open (§9.6) |
| Hover-prefetch | `Vendors.tsx` `warmVendorWizard` | Warms the wizard chunk on pointer-enter, so lazy-loading costs no visible pause |
| Prefetch policy | `vite.config.ts` | Blanket chunk prefetch disabled; hover-prefetch is the targeted successor |
| Skeletons | `components/ui/Shimmer.tsx` | Page-shaped loading states built from the real components |
| Viewport row fit | `components/ui/DataTable.tsx` | Page size measured from available height; reserves the app footer |

---

## 9. Case study — the supplier module

One module worked end to end: §2–§7 applied to a single list screen and its wizard. Recorded because it is the fullest example in the codebase of these techniques landing together, and because two of the corrections are ones every other list page will eventually need.

### 9.1 The list — a 200-row ceiling became real pagination

`Vendors.tsx` opened with `GET /vendors?per_page=200` and did everything else in the browser: the search box, the Fresh / Recurring tabs and the Domestic / International scope pair all filtered the array already in hand.

200 was a **ceiling, not a page**. A tenant with 201 suppliers silently lost the rest — no error, no empty state, nothing to notice. And every load shipped 200 records with their eager-loaded relations in order to render ten rows.

Page, page size, search term, scope and tab now all travel to the API, which returns one page plus a total. The pager reads its page count from that total rather than deriving it from the rows on screen.

| Before | After |
|---|---|
| 200 rows + relations per load, capped | One page (10–24 rows), uncapped |

*Where:* `Vendors.tsx` → `refresh()` · `VendorController::index`

### 9.2 What moving pagination forces you to move with it

Three things break if only the paging moves. All three had to move in the same change.

**Search has to widen.** The browser filter matched contact name, phone, city, state and state code. The server's `q` matched four columns on the vendor row alone — so those five fields would have quietly stopped being findable. The query now joins the address side in: `addresses.contact_name`, `contact_no`, `email`, `city`, `state_code`, plus the resolved `primaryAddress.state.name`.

**Filters have to follow.** Filtering a single page client-side reports the total for the whole set and then renders three rows of it. `scope` and `tab` are query parameters now. A supplier with **no country on record still counts as Domestic** — the same rule the browser applied. With no "All" tab left, a row that matches neither tab is a row nobody ever finds again.

**The page has to reset.** Switching Domestic → International while on page 3 asks the API for page 3 of a one-page result and renders an empty table. `setPage(1)` now fires on tab, scope and search alike.

> **Recurring is deliberately empty.** `opportunity_count` is hardcoded to `0` until the case-to-case procurement flow lands, so Fresh is everything and Recurring is nothing — the same answer the browser was computing from the same zero. The filter is written explicitly as `whereRaw('1 = 0')` so that restoring the count subquery makes it start working without a second edit here.

### 9.3 Two races the client-side version never had

Search is a network call now, so it waits for a pause in typing — **debounced 350 ms**, the same delay `HrEmployees` uses — instead of firing per keystroke.

Rows-per-page is measured from the viewport, so it changes on **every window resize**: two fetches can be in flight at once and the slower must not overwrite the newer. A monotonic request token is captured before the call and compared after it; a stale response returns without touching state — including its error and its loading branches, so a late failure cannot toast over a good page.

*Where:* `reqRef` · `debouncedSearch` in `Vendors.tsx`

### 9.4 The viewport fit was wrong by one row

Auto-fit reserved a flat 16 px below the table. Two things it never accounted for:

- **The app footer**, which this page has — so the card was sized roughly 40 px too tall and the last row sat behind "2026 © IGC Group". Now measured live from `footer.footer`, the same rule `DataTable`'s `bottomReserve()` uses, with a 15 px fallback for contexts that have no footer (inside a modal, say). Measured rather than hardcoded so it survives any zoom level.
- **The horizontal scrollbar**, which occupies height *inside* the scroll box. This table is 15 columns wide, so that bar is always present — 12–15 px, exactly enough for the last row to miss the cut and for the box to grow a vertical scrollbar as well.

The floor moved from 4 rows to 10, matching `minAutoRows` on the HRMS tables. At a floor of 4, a laptop viewport served a four-row page, which reads as a broken list rather than a fitted one and makes the same tenant look different on every machine.

*Where:* `Vendors.tsx` auto-fit effect · `components/ui/DataTable.tsx`

### 9.5 111 KB of CSS out of the JavaScript

This is §10's "CSS out of JavaScript" item, done for one of the three modals it names.

`AddVendorModal.tsx` ended in `export const SCOPED_CSS = ` + a template literal — about 2,000 lines, 111 KB — injected as `<style>{SCOPED_CSS}</style>`. As a string inside a module it:

- could not be minified — esbuild does not look inside a string literal, so every comment and every indent shipped to the browser;
- could not be cached apart from the component;
- could not apply until the JS had downloaded, parsed and executed;
- and broke the entire module if anyone typed a backtick into it.

It is now `add-vendor-modal.css`, imported by the component. Same selectors, same order, same cascade — but Vite extracts, minifies and content-hashes it, and the browser fetches it in parallel with the chunk instead of after it.

The one consumer that borrowed the string, `SupplierEvidenceVaultModal`, no longer imports or injects it: importing `SegmentRefUploadPopup` from that module now pulls the stylesheet in on its own.

| | Before | After |
|---|---|---|
| `AddVendorModal.tsx` | 494 KB | 266 KB |
| Styles | in the JS bundle, unminifiable, blocked on JS | 117 KB hashed stylesheet, parallel fetch, minified |

*Where:* `add-vendor-modal.css` · `AddVendorModal.tsx` · `SupplierEvidenceVaultModal.tsx`

> **Half of that file shrink is not a performance change.** Of the 228 KB the source lost, 111 KB is the stylesheet moving out. The remaining ~117 KB is **comments that were deleted** — the file went from 1,191 comment lines to 53. esbuild already stripped those from the production bundle, so removing them changed the repository, not the download. Judge that half on whether the explanations were worth keeping, not on the byte count; it belongs in a readability discussion, not this document's ledger.

### 9.6 The list route was downloading the wizard it had not opened

Opening the supplier list fetched `AddVendorModal`, `SupplierEvidenceVaultModal`, `SupplierScopeGate`, **jszip and file-saver** — before the table had a single row on it. None of them is reachable without a click.

The modals were already rendered conditionally (`{addOpen && <AddVendorModal …>}`). That was the trap: **conditional rendering decides what to mount, not what to fetch.** A static `import` at the top of the file puts the module in the route's graph unconditionally, and Rollup then wires it as a static import of the route chunk — so the browser fetches it with the page, separate chunk or not.

Verified in the built output rather than assumed. Before, `Vendors-*.js` opened with:

```js
import{A as Ae,M as Ie}from"./AddVendorModal-BSFUfEDl.js";
import{S as Ve}from"./SupplierEvidenceVaultModal-B8NbyF6j.js";
```

— static, with **zero** `import(` calls anywhere in the chunk. After, the same chunk carries four dynamic imports and a Vite dep-map.

The four are now `lazy(() => import(…))` behind `<Suspense fallback={null}>`; the vault is mounted only while `vaultTarget` is set (it already returned `null` when closed and every effect inside it short-circuits on `!open`, so nothing on screen changed); and jszip + file-saver moved to a `Promise.all` of dynamic imports **inside the export handler** — they are zip machinery for one button.

| Fetched on page open | Before | After |
|---|---|---|
| `Vendors` chunk (js + css) | 81.6 KB | **70.2 KB** |
| `AddVendorModal` js + css | 188.5 KB | on Add click |
| `SupplierEvidenceVaultModal` | 59.8 KB | on vault open |
| `jszip` + `file-saver` | 97.9 KB | on Export click |
| `SupplierScopeGate` | inlined in the route chunk | on Add click |
| **Total** | **~428 KB** | **~70 KB** |

359 KB raw / 95.6 KB gzipped moved from page-open to on-demand.

**The trade this introduces, and its answer.** The wizard now arrives *after* the click rather than before it — a visible pause on a slow connection. Pointer-enter and focus on the Add button fire the same `import()` roughly 300 ms early, so the chunk is normally cached by the time the click lands. `React.lazy` reuses the identical promise, so an in-flight prefetch is awaited, not repeated.

That is §10's **hover-prefetch** item, applied at one button rather than to the router.

*Where:* `Vendors.tsx` → `warmVendorWizard` · `SupplierEvidenceVaultModal.tsx` export handler

> **Read the byte counts from a build, not from dev.** The dev server reports `AddVendorModal.tsx` at 1,066 KB — an unbundled module with an inline sourcemap. The same file is 123 KB built, 33 KB gzipped. The dependency graph dev shows you is real and worth acting on; its sizes are not.

### 9.7 What to copy from this, and in what order

The same list-page pattern applies to every table still fetching a ceiling and filtering in the browser.

1. Move page, size, search **and every active filter** to the API in one change — never the paging alone.
2. Widen the server's search to cover exactly the columns the table renders, or those columns stop being searchable.
3. Reset to page 1 on every filter change.
4. Add the request token before you add the debounce; resize-driven page sizes make overlapping fetches routine, not rare.
5. Reserve the footer and the horizontal scrollbar in any viewport-fit maths.
6. Lazy-import every modal, wizard and vault a route can open but does not show. Conditional rendering is not enough — confirm it by looking for a static `import` of it in the built route chunk. Then hover-prefetch the one behind the primary button.

---

## 10. Not yet done

Recorded so the next person does not have to rediscover them.

- **Hover-prefetch for routes.** Start a route's chunk import on link hover or focus. Downloads one chunk, not two hundred, and removes most of the perceived switch delay. *Proven at component level in §9.6 (the supplier Add button); still to be applied to the router's nav links.*
- **Split the six large chunks.** A `manualChunks` rule for the shared heavy libraries would stop route chunks re-bundling them and let the browser cache them once.
- **CSS out of JavaScript — one of three done.** `AddVendorModal` is extracted (§9.5); `AddConsigneeModal` (99 KB), `AddCustomerModal` (56 KB) and `CustomerEvidenceVaultModal` (55 KB) are the next largest. Measured across the SPA, **941 KB still ships inside 24 components as template literals** — unminifiable, uncacheable apart from the component, and unable to apply until the JS has executed. §9.5 is the worked example to copy.
- **Side effects out of transactions.** Eight controllers call mail, storage or dispatch inside a `DB::transaction`. A rollback restores the database but does not un-send the email or un-delete the file.

---

*Every figure in this document was read from the codebase or from Telescope, not estimated. Where a number is missing, the technique had no measurement worth quoting.*
