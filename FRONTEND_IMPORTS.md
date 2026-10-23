# Frontend imports & code splitting

How this app decides *when* a piece of JavaScript reaches the browser. Five
mechanisms, each with a different cost. Pick the wrong one and you pay in
seconds, not kilobytes.

**The one number to keep in your head:** on the production server a request
costs **~1 second regardless of size**. Measured, not assumed — `/up` (boots
Laravel, no auth, no DB, no app code) takes ~1 s there versus 119 ms locally,
and `unread-count` returns **400 bytes** in **1.32 s**. Every rule below follows
from that.

---

## 1. Static import — "I need this to render"

```ts
import { Card, CardBody } from 'reactstrap';
import { to12h } from '../../../utils/timeFormat';
```

Resolved before the importing module runs. The browser must have it in hand
before your component can render.

**Use for:** anything the component needs on first paint.

**The trap:** a static import is *transitive*. Importing one thing from a file
drags in that file's whole import graph.

> **Real case.** `AttendanceTab.tsx` wanted one function, `to12h`. It imported
> it from `RegularizationApprovals.tsx`, which re-exported it for convenience.
> That made two route chunks share a subtree, Rollup hoisted it, and the result
> was an 11.5 kB `timeFormat-*.js` file costing a full second on the server.
> Fixing the import to point at `utils/timeFormat` — where `to12h` actually
> lives — deleted the chunk entirely.

**Rule:** import from the module that *defines* a thing, never through a module
that happens to re-export it.

---

## 2. Dynamic import — "I need this later, maybe never"

```ts
const { default: Swal } = await import('sweetalert2');
```

Returns a promise. Vite emits a separate file and fetches it only when the line
executes. Calling it twice is one request — ES modules are cached by specifier.

**Use for:** code behind an interaction that most visits never trigger — an
export routine (`xlsx`, 420 kB), a PDF preview (`pdfjs-dist`), face recognition
(`face-api.js`), a confirmation dialog.

**Don't use for:** small things, or things needed on mount. You are trading
bytes for a round trip, and here a round trip costs a second.

> `face-api.js` is dynamically imported on `FaceCapture`'s first mount. Vite's
> dep scanner can't see it, so it's force-listed in `optimizeDeps.include` —
> see the comment in `vite.config.js`.

---

## 3. `lazyPage` — route-level splitting

```ts
// resources/js/components/App.tsx — 114 of these
const HrAttendance = lazyPage(() => import('../pages/hrms/HrAttendance'));
```

`React.lazy` + a dynamic import, so a route's code doesn't exist in the browser
until someone navigates to it. This is why first load is fast.

**`lazyPage` is not plain `React.lazy`** — see `resources/js/utils/lazyPage.ts`.
A deploy deletes the old content-hashed chunks. A tab opened *before* the deploy
still holds the old `index.html`, so its next navigation requests a filename
that no longer exists; Apache misses, Laravel's SPA catch-all returns HTML, the
browser refuses it as a module, and bare `React.lazy` white-screens with no way
to recover. `lazyPage` catches that and reloads once, guarded by a 10-second
`sessionStorage` cooldown so a genuinely missing asset can't loop.

**Always use `lazyPage`, never `React.lazy`, for anything route-shaped.**

While the chunk is in flight, `<Suspense fallback={<RouteFallback />}>` holds
the space. `RouteFallback` stays at `opacity: 0` for 180 ms, so a fast fetch
shows nothing at all.

---

## 4. `manualChunks` — how modules are grouped into files

`vite.config.js` → `build.rollupOptions.output.manualChunks`. A function Rollup
calls once per source file asking "which output file should this go in?".
Return a name, or return nothing to keep Rollup's default.

**Why we override the default.** Rollup hoists any module two chunks share into
a file of its own — which saves bytes and costs a request. On a normal server
that's right. Here it produced this for `/hr/attendance`:

```
Card.js         1.2 kB      BusyOverlay.js   0.5 kB
CardBody.js     1.0 kB      SearchClear.js   0.6 kB
```

**3.3 kB of code for roughly four seconds.** Thirteen requests before React
could mount the page.

So we group by *who needs it* and *how often it changes*:

| chunk | contents | why |
|---|---|---|
| `vendor-react` | react, react-dom, scheduler, react-router | changes only on upgrade — own hash, survives our deploys |
| `vendor-redux` | redux, react-redux, @reduxjs, immer, reselect | same |
| `vendor-ui` | reactstrap, @popperjs | kills `Card.js`, `CardBody.js`, `ModalBody.js` as separate files |
| `shared-ui` | 8 named primitives + `masterFormKit` | on nearly every screen: one request, then cached |

**`shared-ui` is an allowlist, not a directory rule.** The first attempt folded
all of `components/ui` in and produced a **454 kB** chunk, because that
directory totals 568 kB — `DataTable` (56 kB), `MasterSelect`, `SignaturePad`,
`ImageCropperModal`. Those stay split; Rollup hoists them into a shared chunk
anyway, fetched once and cached.

The allowlist was chosen from measured importer counts — Tooltip 115,
Shimmer 79, SearchClear 64, WorklistPager 50, SegmentBadge 25 — not by eye.

**Measured across all 108 lazy routes:**

```
total requests:  1,237 → 753   (−39%)
mean per route:   11.5 → 7.0
improved: 87    unchanged: 21    worse: 0
```

```
HrAttendance      13 → 3        SalesMatrixDetail   67 → 50
HrBiometricDevices 14 → 4       Products            38 → 22
HrRecruitment     11 → 4        MasterPage          27 → 12
GenerateDocument   6 → 1        EmployeeProfile     36 → 22
```

### ⚠ Changing `manualChunks` safely

Bad grouping causes **circular chunk initialisation**: chunk A's top-level code
runs before chunk B has initialised, giving `Cannot access 'X' before
initialization` or `undefined is not a function`.

**This fails only in the production build.** `npm run dev` serves unbundled
ESM and will never reproduce it. After any change:

1. `npm run build`
2. Delete `public/hot` (otherwise Laravel serves the dev server and you are
   testing nothing — source filenames like `HrAttendance.tsx` in the Network
   tab mean you're on dev)
3. Click through several routes with the Console open

---

## 5. Prefetch — fetch it before the click

`resources/js/utils/routePrefetch.ts`. Because `import()` is cached by
specifier, calling it ahead of time and `lazyPage`'s call inside are **one
request**. Run it first and `React.lazy` resolves from memory — the Suspense
fallback never paints.

```ts
prefetchRoute('/hr/attendance');      // warm one route
startIdlePrefetch(paths);             // walk a list during idle time
```

Two triggers:

- **Idle** — `App.tsx` fires `startIdlePrefetch` once the user is known,
  filtered through `canAccessPath` so nobody warms a module they can't open.
  One chunk per idle slot; firing fourteen at once would contend with the API
  calls the current screen is still making. `requestIdleCallback` with a
  `setTimeout` fallback, because **Safari doesn't have it** and our floor is
  `safari16.4`. Skipped entirely on `saveData` or a `2g` connection.
- **Hover / touch / focus** — wired at all five sidebar `<Link>` sites in
  `velzon/Layouts/VerticalLayouts/index.tsx`. `onTouchStart` because there is no
  hover on the Zebra handheld; `onFocus` for keyboard nav.

**Why idle and not just hover.** Timing:

```
hover → click                 300–800 ms
page painted → user clicks      2–30 s
/hr/attendance needs           ~2,900 ms on the server
```

Hover alone takes 2.9 s down to ~2.4 s — still a visible shimmer. Only idle has
the runway.

### Adding a route to the prefetch list

`ROUTES` is **generated from `App.tsx`**, not typed, because a specifier that
differs by one character makes Vite emit a second module — you download the
chunk twice and warm the wrong one. After adding routes, regenerate it:

```php
// php regen.php  — prints the ROUTES body; paste it over the existing one
$s = file_get_contents('resources/js/components/App.tsx');
preg_match_all('/const\s+(\w+)\s*=\s*lazyPage\(\(\) => import\(\'([^\']+)\'\)\)/', $s, $m);
$spec = array_combine($m[1], $m[2]);
preg_match_all('/<Route\s+path="([^"]+)"\s+element=\{<(\w+)\s*\/?>/', $s, $r);
$pairs = [];
foreach ($r[1] as $i => $path) {
    $c = $r[2][$i];
    if (!isset($spec[$c]) || str_contains($path, ':') || str_contains($path, '*')) continue;
    $pairs[$path] = $spec[$c];
}
ksort($pairs);
$w = 0; foreach (array_keys($pairs) as $k) $w = max($w, strlen($k) + 3);
foreach ($pairs as $path => $sp) {
    echo '  ' . str_pad("'$path':", $w + 1) . "() => import('$sp'),\n";
}
```

A route with a parameter (`/master/:slug`) is skipped by that script — the
param does not change the chunk, so those go in the `PATTERNS` table by hand,
one regex per route. `/master/:slug` and `/clm/:slug` each cover a whole menu
section, which is why they are worth having. The dedupe key for a pattern is
its NAME, not the path, so warming `/master/countries` also settles
`/master/states` rather than filling the set with fifty entries for one chunk.

Then verify:

```bash
# every prefetch specifier must be character-identical to an App.tsx one.
# Expect "not matching App.tsx: 0".
php -r '
$a = file_get_contents("resources/js/components/App.tsx");
preg_match_all("/lazyPage\(\(\) => import\(\x27([^\x27]+)\x27\)\)/", $a, $m);
$app = array_flip($m[1]);
$p = file_get_contents("resources/js/utils/routePrefetch.ts");
preg_match_all("/\(\) => import\(\x27([^\x27]+)\x27\)/", $p, $n);
$bad = array_filter(array_unique($n[1]), fn($s) => !isset($app[$s]));
printf("prefetch specifiers: %d   not matching App.tsx: %d\n", count(array_unique($n[1])), count($bad));
foreach ($bad as $b) echo "  MISMATCH: $b\n";'
```

Keep the list short. Prefetching all 114 routes costs more than it saves, and
heavy pages are deliberately excluded — `SalesMatrixDetail` is 927 kB gzipped
across 50 chunks, which is not something to fetch on spec. Those rely on hover.

---

## Choosing

| situation | use |
|---|---|
| needed to render | static import — from the defining module |
| a whole page/route | `lazyPage(() => import(...))` |
| behind a click most users never make, and large | dynamic `import()` |
| small and on nearly every screen | add to the `shared-ui` allowlist |
| framework / third-party on every screen | a `vendor-*` chunk |
| a module landing page | add to `routePrefetch` |

**Two habits worth keeping:**

1. **Fewer requests beats fewer bytes.** A 1 kB file and an 80 kB file cost the
   same second. Splitting out 12 kB to avoid duplicating it is a loss.
2. **Measure the build, not dev.** Dev ships unminified source with inline
   sourcemaps — `recruitment.css` reports 486 kB there and ~15 kB in the build.
   Dev-mode numbers tell you nothing about production.

---

## Known next steps

- `SalesMatrixDetail` (50 chunks), `ClmCaseToCasePage` (47),
  `ClmBuyerProfilePage` (42) — all **static** imports, zero dynamic. A
  per-module `manualChunks` group (`sales-shared`, `clm-shared`) would collapse
  them the same way `shared-ui` did.
- `sweetalert2` (80 kB) is imported at module level in several screens but only
  used for confirm dialogs. Moving it to a dynamic `import()` inside the
  handlers removes one request from every one of them.
- The ~1 s per-request floor is infrastructure, not code: check OPcache in the
  PHP-FPM pool, `pm.max_children`, `php artisan config:cache` + `route:cache`,
  and enable **HTTP/2** — 16 requests against the HTTP/1.1 six-connection cap is
  why chunks queue behind API calls at all. No amount of frontend work
  substitutes for that.
