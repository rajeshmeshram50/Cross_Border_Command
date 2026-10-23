/* Fetch a route's chunks BEFORE the click, so Suspense never suspends.
 *
 * Every route is lazyPage(() => import(...)), so its code does not exist in the
 * browser until it is clicked — and on the server a request costs ~1s whatever
 * its size, so /hr/attendance (3 chunks) waited ~3s and SalesMatrixDetail (50)
 * far longer, with RouteFallback's skeleton standing in. The skeleton is not
 * the problem; the gap is.
 *
 * ES modules are cached by specifier, so the import() below and the one inside
 * lazyPage are ONE request. Run it first and React.lazy resolves from memory —
 * the fallback never paints. One call also covers a route's whole static graph,
 * which is why the heavy CLM/Sales pages benefit most: they have 50 static
 * imports and no dynamic ones.
 */

/* Route path -> the SAME import specifier App.tsx uses. It has to match
   character for character or Vite treats it as a second module. */
const ROUTES: Record<string, () => Promise<unknown>> = {
  '/hr/attendance':        () => import('../pages/hrms/HrAttendance'),
  '/hr/employees':         () => import('../pages/hrms/HrEmployees'),
  '/hr/recruitment':       () => import('../pages/recruitment/HrRecruitment'),
  '/hr/leave':             () => import('../pages/hrms/HrLeave'),
  '/hr/leave-plans':       () => import('../pages/hrms/HrLeavePlans'),
  '/hr/exit-management':   () => import('../pages/hrms/HrExitManagement'),
  '/hr/document-templates':() => import('../pages/hrms/HrDocumentTemplates'),
  '/hr/overview':          () => import('../pages/hrms/HrOverview'),
  '/clock-in':             () => import('../pages/ClockIn'),
  '/my-team':              () => import('../pages/MyTeam'),
  '/products':             () => import('../pages/p2p/p2p-master-management/product-management/Products'),
  '/vendors':              () => import('../pages/p2p/p2p-master-management/supplier-management/Vendors'),
  '/payments':             () => import('../pages/Payments'),
  '/settings':             () => import('../pages/Settings'),
};

/* Prefetched or in flight. import() dedupes anyway; this skips the bookkeeping
   and keeps the idle walk from re-queueing what it already did. */
const done = new Set<string>();

/** True when prefetching would compete with the page the user is actually on. */
function networkIsCheap(): boolean {
  try {
    const c = (navigator as any)?.connection;
    if (!c) return true;                       // unknown — assume fine
    if (c.saveData) return false;
    return !/(^|-)2g$/.test(String(c.effectiveType || ''));
  } catch {
    return true;
  }
}

/** Warm one route. Safe to call repeatedly and on paths we do not know. */
export function prefetchRoute(path?: string | null): void {
  if (!path) return;
  const key = path.split('?')[0].replace(/\/+$/, '') || '/';
  if (done.has(key)) return;
  const load = ROUTES[key];
  if (!load) return;
  done.add(key);
  // A failed prefetch must stay invisible — the click still loads it normally.
  try { void load().catch(() => { done.delete(key); }); } catch { done.delete(key); }
}

/* Safari has no requestIdleCallback (our floor is safari16.4), so fall back to
   a timeout — later than ideal, still long before the user clicks. */
const whenIdle: (fn: () => void) => void =
  typeof window !== 'undefined' && 'requestIdleCallback' in window
    ? (fn) => (window as any).requestIdleCallback(fn, { timeout: 4000 })
    : (fn) => window.setTimeout(fn, 1200);

/**
 * Walk the landing pages during idle time, one per slot.
 *
 * One at a time on purpose: firing fourteen imports at once would contend with
 * the API calls the current screen is still making, which is the problem this
 * is meant to remove.
 */
export function startIdlePrefetch(paths?: string[]): void {
  if (typeof window === 'undefined' || !networkIsCheap()) return;
  const queue = (paths?.length ? paths : Object.keys(ROUTES))
    .map((p) => p.split('?')[0].replace(/\/+$/, '') || '/')
    .filter((p) => ROUTES[p] && !done.has(p));

  const step = () => {
    const next = queue.shift();
    if (!next) return;
    prefetchRoute(next);
    if (queue.length) whenIdle(step);
  };
  whenIdle(step);
}

/** Paths this build can prefetch — used to skip work on unknown links. */
export const isPrefetchable = (path?: string | null): boolean =>
  !!path && !!ROUTES[path.split('?')[0].replace(/\/+$/, '') || '/'];
