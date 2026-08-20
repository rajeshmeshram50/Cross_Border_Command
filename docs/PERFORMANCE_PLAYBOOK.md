# Performance Playbook

Four problems, the methods available for each, and how to pick between them.

Written against this codebase — every number below was measured here, not quoted
from an article. Where we already solved something, the existing pattern is
named so the next screen copies it instead of inventing a sixth approach.

| Tab | Problem | First thing to reach for |
|---|---|---|
| [1. List view](#1-list-view) | table takes too long to show data | server pagination |
| [2. Forms](#2-forms) | wizard is slow to open and slow to save | one bootstrap call + dirty check |
| [3. Master data](#3-master-data) | same lookups fetched over and over | the cached `master-bundle` pattern |
| [4. Dropdowns](#4-dropdowns) | pickers ship far more than they show | `?fields=id,name` + lazy open |

---

## 1. List view

### The problem

A list screen is slow for one of three separate reasons, and they need different
fixes. Diagnose before choosing:

| Symptom | Cause | Look at |
|---|---|---|
| Response is large (MB) | too many rows, or too many columns per row | payload size in Network tab |
| Response is slow but small | N+1 queries, or missing index | query count |
| Several identical requests | the page is fetching more than once | Network tab, count the calls |

### The root cause, stated plainly

**The endpoint returns everything unless asked otherwise, and the screen never
asks.** Both halves matter:

```php
// The prevailing shape. Paginate only when a page is requested…
if ($request->has('per_page') || $request->has('page')) {
    return response()->json($q->paginate($perPage));
}
return response()->json($q->get());   // …otherwise: the whole table.
```

That fallback is correct and must stay — a dozen screens read `/employees` as a
plain array, and returning an envelope unconditionally would blank all of them.
The bug is that **list screens take the fallback**. They send no `page`, no
`per_page`, receive every row, and slice in the browser.

Audited across the app:

| | Count |
|---|---|
| Pages rendering `<DataTable>` | 22 |
| …passing `serverPagination` | **1** (`HrEmployees.tsx`) |
| …sending no pagination params at all | **20** |
| …sorting client-side | **16** |
| API controllers that *can* paginate | 14 of 96 |

Screens outside `DataTable` do it explicitly instead:
`/payments?per_page=9999` (twice on one screen), `/clients?per_page=9999`,
`/branches?per_page=9999`, leads at `1000`, products at `500`.

### Why nobody has fixed it yet — the hidden coupling

Client-side sort and client-side search **require every row to be present**. So
"turn on pagination" is never a one-line change:

| Currently in the browser | Must move to SQL | If you forget |
|---|---|---|
| Sorting | `ORDER BY` | the sort orders one page, not the table |
| Search box | `WHERE … LIKE` | the box filters one page — looks like it works |
| Row counts / tab badges | `COUNT(*)` with the same filters | badges contradict the table (QA #173) |

**16 of 22 screens sort client-side.** That is the real reason the list stayed
unpaginated, and it is the work item to plan for — not the `paginate()` call,
which is the easy part.

### The methods

| Method | What it fixes | Cost | Use when |
|---|---|---|---|
| **Server pagination** | row count | must move search + sort + counts to SQL — see the coupling above | the list grows with the tenant. **Default.** |
| **Send the page params** | the fetch-all fallback | none — the endpoint already supports it | the controller paginates but the screen never asks |
| **Column trimming** (`LIST_COLUMNS`) | row width | must keep the list in sync with the UI | rows carry fields the table never renders |
| **Drop `$appends`** (`LIST_DROP_APPENDS`) | hidden per-row queries | accessor unavailable in list mode | an accessor runs a query or a decrypt per row |
| **Eager load** (`LIST_WITH`) | N+1 | none — strictly better | any relation touched inside the row loop |
| **Separate count endpoint** | counting cost | one extra request | KPI cards / tab badges beside a paginated list |
| **DB index** | slow WHERE / ORDER BY | write cost, disk | a filter or sort column with no index |
| **Deferred widgets** | time-to-first-row | more moving parts | charts and cards that aren't the main content |
| **Skeleton** | *perceived* speed only | none | always — but it is not a fix |

### Order to apply them

0. **Check whether the endpoint already paginates.** 14 controllers do. If yours is one, half the work is done — send `page` + `per_page` and move sort/search to SQL. If it isn't, add the conditional block first.
1. **Count the queries.** If it's ~1 per row, you have an N+1 — eager load it. This is the cheapest win and often the biggest.
2. **Look at the payload.** If it's large for the rows shown, trim columns and drop appends.
3. **Then paginate.** Pagination on top of an N+1 still runs the N+1, just fewer times.
4. **Then index** whatever the slow query filters on.
5. **Skeleton last** — it changes how the wait feels, not how long it is.

### Worked example — the Employee list

Three N+1s were found, all invisible in the code:

- HolidayGroup count accessors — ~118 queries
- reporting manager `photo_url` — one lookup per row
- `ancillary_roles_resolved` — one per row

Fixed by naming the relations in `LIST_WITH` (column-limited, so a relation
doesn't drag a whole model and re-run *its* accessors), listing the eleven
columns the table shows in `LIST_COLUMNS`, and dropping two accessors via
`LIST_DROP_APPENDS`. Result: **14 queries, 29 KB** for a page of rows.

`LIST_COLUMNS` also stopped `bank_account_number`, `ifsc_code`, `pan_number`,
`uan_number` and salary going to every user who can open the employee list. Not
a performance win — a data one. Worth remembering that trimming columns is
usually both.

> **Trap we hit:** a viewport-sized page (`autoFitRows`) makes page size a
> *network* variable — every re-measure is a request. It walked 2→3→4→3→2, one
> XHR per step. New tables should use fixed sizes (10/25/50). See
> [PAGINATION_STANDARD](#) for the full rule.

---

## 2. Forms

### The problem

Two different waits, often confused:

- **Opening** — how many requests before the first field is usable
- **Saving** — how much work one Save actually causes

### The methods

| Method | What it fixes | Cost | Use when |
|---|---|---|---|
| **One bootstrap call** | open time | a new endpoint per form | the form opens with 4+ lookup requests |
| **Dirty check** | needless writes | must snapshot a baseline | multi-step wizards that save between steps |
| **Partial payload** | write size | server must validate `nullable`, not `required` | any update where most fields didn't change |
| **Defer later steps** | open time | data must load on arrival | step 3 needs data step 1 doesn't |
| **Client-side validation first** | round trips | rules duplicated in two places | validation the browser can decide alone |
| **Debounced uniqueness checks** | request storms | slight lag before the error | check-as-you-type fields (mobile, email, code) |
| **Don't refetch the list per step** | wasted requests | list refreshes later instead | the list is behind a modal nobody can see |
| **Optimistic UI** | *perceived* speed | rollback logic; can show a lie | short, near-certain writes only |

### Order to apply them

1. **Count the requests on open.** Four or more lookups → one bootstrap call.
2. **Count the queries on save.** If saving one field costs the same as saving all of them, add the dirty check and partial payload.
3. **Remove refreshes nobody sees** — refetching a table behind a modal is pure cost.
4. **Then** consider deferring steps.

### Worked example — the Employee wizard

**Saving.** Every step PUT posted all 104 fields. The server validated all of
them, re-derived every dependent column and rewrote relations:

| | Queries | Writes |
|---|---|---|
| Before — full payload | 353 | 18 |
| After — changed keys only | 88 | 3 |

The partial body is only safe because `update()` validates with `nullable`
rather than `required`, and Laravel's `validated()` returns **only the keys
actually sent** — absent fields are never filled in. If either changes, partial
PUTs start blanking columns. Worth a comment at the endpoint.

**The dirty check needs a baseline**, and the baseline must be in *payload
shape*, not response shape. The API sends `middle_name: ""` and
`country_id: "12"`; the payload sends `null` and `12`. Compare against the raw
response and every such field reads as changed on the first comparison.

Timing matters too: the fields arrive in one render, but several are *derived* a
render later (display name from name parts, salary date from joining date, legal
entity from branch). A snapshot taken too early misses those and they look like
user edits. The fix is to defer the snapshot by a tick and cancel it on any
re-render — it lands only once a render causes no further render.

Failure direction is safe by construction: no baseline → always save. A
redundant write, never a lost one.

---

## 3. Master data

### The problem

Lookups that change maybe monthly, fetched on every form open, one request each.
The payload was never the problem — the request *count* was. Five sequential
round-trips behind the browser's connection limit cost 2.3–5.1 s for ~13 KB.

### The methods

| Method | What it fixes | Cost | Use when |
|---|---|---|---|
| **Bundle endpoint** | request count | one endpoint per form | a form opens 4+ master requests |
| **Server cache** (`Cache::remember`) | DB load | staleness until TTL | masters read far more than written |
| **Version-stamped keys** | stale cache | one cache write per master edit | any cache without tag support (file/db driver) |
| **Client cache** (sessionStorage) | repeat opens | must be busted on master edits | the same form is opened repeatedly |
| **`?fields=id,name`** | payload size | none for dropdowns | the consumer only needs id + label |
| **Load at app bootstrap** | per-form wait | slows login; wasted if unused | a lookup nearly every screen needs |

### The pattern this codebase already has

**Use this. Do not invent a sixth mechanism.** Customer, Product, Vendor, Client
and Branch forms all share it:

| Layer | Where | Behaviour |
|---|---|---|
| Server bundle | `CustomerController::masterBundle()` and siblings | 9 masters in one response |
| Server cache | `Cache::remember`, 5-min TTL, per-user key | absorbs repeat opens |
| Cache versioning | `App\Support\MasterBundleCache` | `bump()` on any master write orphans every key at once |
| Client cache | `*BundleCache.ts` (sessionStorage, 5-min) | repeat opens don't hit the network |
| Client busting | `bustAllMasterBundles()` | call from **any** screen that edits a master |

Two details worth copying rather than rediscovering:

- **Per-user cache keys are a tenant boundary**, not just a convenience. Without
  `MasterVisibility::applyReadScope` inside the closure, a client_admin of
  Client A would see Client B's tenant-scoped rows through the bundle.
- **Version stamping instead of key enumeration**, because the file and database
  cache drivers have no tag support. `bump()` writes one integer; every existing
  key becomes unreachable and expires naturally.
- The client cache caused **QA #23** ("newly added Segment not reflected in
  dropdown without page refresh"). Both layers must be busted, not just one.

### Where the Employee form stands

It is the **outlier**. It uses `/master/bulk` — which collapses five
`/master/*` calls into one, but is **not cached on either layer** — plus four
dedicated endpoints (`/branch-legal-entities`, `/holiday-groups`,
`/leave-plans`, `/branch-shifts`) that aren't in the bundle at all.

**Recommendation:** replace both with `GET /employees/form-bundle`, following the
`masterBundle()` pattern exactly — same cache helper, same TTL, same busting.
That takes the Employee form from six requests to one, and gets it cached for
free. `/master/bulk` stays as the generic escape hatch for screens that don't
justify their own bundle.

---

## 4. Dropdowns

### The problem

A picker shows a name and stores an id, but usually receives an entire row —
and sometimes an entire table. `/master/countries` without `?fields` ships
**104 KB of ownership metadata for 249 rows** to populate a list of country
names.

### The methods

| Method | What it fixes | Cost | Use when |
|---|---|---|---|
| **`?fields=id,name`** | payload size | none | always, for every picker |
| **Load on first open** | requests never needed | small delay on first click | the field is optional or rarely touched |
| **Include in the form bundle** | request count | bundle grows | the field is on the first screen the user sees |
| **Server-side search** | unbounded lists | needs a search endpoint + debounce | the set has no ceiling (employees, products, leads) |
| **Virtualised rendering** | slow *rendering*, not fetching | more complex component | 500+ options actually in the DOM |
| **Dependent loading** | fetching irrelevant rows | an extra request on parent change | states-by-country, city-by-state |

### Choosing — by how big the list can get

| Size | Approach |
|---|---|
| **Under ~50** (currencies, UOM, roles) | in the form bundle, `?fields=id,name`. Never a separate request. |
| **50–500** (countries, departments) | bundle it if the field is on screen at open; otherwise lazy-load on first open. |
| **Unbounded** (employees, products, customers) | server-side search. Never load "all" — that is the `per_page=9999` mistake wearing a dropdown. |

The question is the same one the pagination standard asks: *can this grow with
the tenant's business?* A picker over a growing table is a list view with a
different shape, and it needs the same answer.

### Already in use here

- `/master/states` is deliberately **not** in the Employee masters load — it
  returns every subdivision on earth. It loads per-country instead
  (`{ country_id, fields: 'id,name' }`), which is the dependent-loading pattern.
- Two Employee dropdowns already lazy-load with `onOpen={() => reloadMasters()}`.
- `AddVendorModal` fetches products with `?per_page=500&lite=1` — a step in the
  right direction that stops short: `lite=1` trims the row, but 500 is still a
  ceiling that a growing catalogue will hit.

---

## Picking a method — the short version

Three questions, in order. Most screens are fixed by the first.

1. **Are we asking for data nobody displays?** → trim columns, `?fields`, drop appends, paginate.
2. **Are we asking more than once for the same thing?** → bundle it, cache it, dirty-check it.
3. **Only then:** is the query itself slow? → index it, restructure it.

And one rule that outranks all of them: **measure first.** Every number in this
document came from counting queries and bytes on a real request. Three of our
four biggest wins were invisible in the code and obvious in the query log — and
one "obvious" N+1 turned out not to exist once the eager loads were included.
