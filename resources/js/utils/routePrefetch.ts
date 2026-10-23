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
   character for character or Vite treats it as a second module, so this block
   is GENERATED from App.tsx rather than typed. To regenerate after adding
   routes, see the snippet in FRONTEND_IMPORTS.md. */
const ROUTES: Record<string, () => Promise<unknown>> = {
  '/branches/users':                        () => import('../pages/UsersPage'),
  '/clients/users':                         () => import('../pages/UsersPage'),
  '/clm':                                   () => import('../pages/clm/shared/ClmStubPage'),
  '/clm/agreements':                        () => import('../pages/clm/document-masters/ClmAgreementsPage'),
  '/clm/agreements-sent':                   () => import('../pages/clm/operations/ClmAgreementsSentPage'),
  '/clm/agreements-to-approve':             () => import('../pages/clm/operations/ClmAgreementsToApprovePage'),
  '/clm/analytics':                         () => import('../pages/clm/command-center/ClmAnalyticsPage'),
  '/clm/authority':                         () => import('../pages/clm/compliance/ClmAuthorityPage'),
  '/clm/buyer-profile':                     () => import('../pages/clm/operations/ClmBuyerProfilePage'),
  '/clm/case-to-case':                      () => import('../pages/clm/operations/ClmCaseToCasePage'),
  '/clm/clause-library':                    () => import('../pages/clm/document-masters/ClmClauseLibraryPage'),
  '/clm/diagnosis-resolution':              () => import('../pages/clm/command-center/ClmDiagnosisResolutionPage'),
  '/clm/document-panel':                    () => import('../pages/clm/compliance/ClmDcpPage'),
  '/clm/due-diligence':                     () => import('../pages/clm/compliance/ClmDdPage'),
  '/clm/kyc':                               () => import('../pages/clm/compliance/ClmKycPage'),
  '/clm/quality-docs':                      () => import('../pages/clm/compliance/ClmQcPage'),
  '/clm/regulatory-defense':                () => import('../pages/clm/command-center/ClmRegulatoryDefenseFilePage'),
  '/clm/segment':                           () => import('../pages/clm/compliance/ClmSegmentPage'),
  '/clm/supplier-profile':                  () => import('../pages/clm/operations/ClmSupplierProfilePage'),
  '/clm/terms-conditions':                  () => import('../pages/clm/document-masters/ClmTncPage'),
  '/clm/trade-documents':                   () => import('../pages/clm/document-masters/ClmTradeDocumentsPage'),
  '/clm/trade-licenses':                    () => import('../pages/clm/compliance/ClmTradeLicensesPage'),
  '/clock-in':                              () => import('../pages/ClockIn'),
  '/credentials-vault':                     () => import('../pages/ModuleStubPage'),
  '/dev-tools':                             () => import('../pages/dev-tools/DevTools'),
  '/developers/shipment':                   () => import('../pages/developers/DeveloperShipments'),
  '/documentation':                         () => import('../pages/Documentation'),
  '/gmail':                                 () => import('../pages/Gmail'),
  '/gts':                                   () => import('../pages/ModuleStubPage'),
  '/hr':                                    () => import('../pages/hrms/HrDashboard'),
  '/hr/attendance':                         () => import('../pages/hrms/HrAttendance'),
  '/hr/broadcast':                          () => import('../pages/hrms/HrBroadcastCentre'),
  '/hr/custom-fields':                      () => import('../pages/hrms/HrCustomFields'),
  '/hr/devices':                            () => import('../pages/hrms/HrBiometricDevices'),
  '/hr/doc-templates':                      () => import('../pages/hrms/HrDocumentTemplates'),
  '/hr/doc-templates/new':                  () => import('../pages/hrms/doc-templates/TemplateForm'),
  '/hr/employee-onboarding':                () => import('../pages/employee-onboarding/HrEmployeeOnboarding'),
  '/hr/employees':                          () => import('../pages/hrms/HrEmployees'),
  '/hr/exit-management':                    () => import('../pages/hrms/HrExitManagement'),
  '/hr/expense':                            () => import('../pages/hrms/HrExpenseManagement'),
  '/hr/holiday':                            () => import('../pages/hrms/HrHoliday'),
  '/hr/leave':                              () => import('../pages/hrms/HrLeave'),
  '/hr/leave-approvals':                    () => import('../pages/hrms/HrLeaveApprovals'),
  '/hr/leave-plans':                        () => import('../pages/hrms/HrLeavePlans'),
  '/hr/overview':                           () => import('../pages/hrms/HrOverview'),
  '/hr/payroll':                            () => import('../pages/hrms/HrPayroll'),
  '/hr/pip':                                () => import('../pages/hrms/HrPIP'),
  '/hr/recruitment':                        () => import('../pages/recruitment/HrRecruitment'),
  '/inbox':                                 () => import('../pages/Inbox'),
  '/inventory':                             () => import('../pages/inventory/InventoryPutAway'),
  '/inventory-management/product-flags':    () => import('../pages/inventory-management/product-flag/ProductFlagMaster'),
  '/inventory-management/rack-master':      () => import('../pages/inventory-management/rack/RackMaster'),
  '/inventory-management/warehouse-master': () => import('../pages/inventory-management/warehouse/WarehouseMaster'),
  '/inventory-management/zone-master':      () => import('../pages/inventory-management/zone/ZoneMaster'),
  '/inventory/devices':                     () => import('../pages/inventory/InventoryScanDevices'),
  '/inventory/scan-log':                    () => import('../pages/inventory/InventoryScanLog'),
  '/inventory/stickers':                    () => import('../pages/inventory/InventoryStickers'),
  '/master':                                () => import('../pages/MasterDashboard'),
  '/master/segments':                       () => import('../pages/clm/compliance/ClmSegmentPage'),
  '/my-team':                               () => import('../pages/MyTeam'),
  '/p2p':                                   () => import('../pages/sales/opportunity-pipeline/SalesP2PSummary'),
  '/p2p/advance-refund-adjustment':         () => import('../pages/p2p/payment-management/advance-refund/AdvanceRefundAdjustment'),
  '/p2p/analytics':                         () => import('../pages/ModuleStubPage'),
  '/p2p/bulk-sourcing':                     () => import('../pages/p2p/procurement-management/bulk-sourcing/P2pBulkSourcing'),
  '/p2p/case-to-case':                      () => import('../pages/ModuleStubPage'),
  '/p2p/diagnosis':                         () => import('../pages/ModuleStubPage'),
  '/p2p/order':                             () => import('../pages/p2p/purchase-management/order/po-list/Order'),
  '/p2p/payment-request':                   () => import('../pages/p2p/payment-management/payment-request/PaymentRequestManagement'),
  '/p2p/supplier-purchase-invoice':         () => import('../pages/p2p/purchase-management/invoice/InvoiceList'),
  '/permissions':                           () => import('../pages/permission/Permissions'),
  '/products':                              () => import('../pages/p2p/p2p-master-management/product-management/Products'),
  '/project-navigator':                     () => import('../pages/ModuleStubPage'),
  '/putaway-scan':                          () => import('../pages/p2p/putaway/PutawayScan'),
  '/putaway-scan/enroll':                   () => import('../pages/p2p/putaway/PutawayScan'),
  '/sales/analytics':                       () => import('../pages/sales/insights-productivity/SalesAnalytics'),
  '/sales/consignee':                       () => import('../pages/sales/core-masters/consignee/SalesConsignee'),
  '/sales/customers':                       () => import('../pages/sales/core-masters/customer/SalesCustomers'),
  '/sales/diagnosis':                       () => import('../pages/sales/insights-productivity/SalesDiagnosis'),
  '/sales/lead-ack-master':                 () => import('../pages/sales/core-masters/lead-ack/SalesLeadAckMaster'),
  '/sales/lead-distribution':               () => import('../pages/sales/opportunity-pipeline/AssignedLeadsModal'),
  '/sales/lead-worksheet':                  () => import('../pages/sales/opportunity-pipeline/SalesLeadWorksheet'),
  '/sales/leads-details':                   () => import('../pages/sales/opportunity-pipeline/SalesLeadsDetails'),
  '/sales/p2p-summary':                     () => import('../pages/sales/opportunity-pipeline/SalesP2PSummary'),
  '/sales/performance':                     () => import('../pages/sales/insights-productivity/SalesPerformance'),
  '/sales/qpi':                             () => import('../pages/sales/opportunity-pipeline/SalesQPI'),
  '/sales/resolution-center':               () => import('../pages/sales/insights-productivity/SalesResolutionCenter'),
  '/sales/sign-tracker':                    () => import('../pages/sales/opportunity-pipeline/SalesSignTracker'),
  '/sales/todo':                            () => import('../pages/sales/insights-productivity/SalesTodo'),
  '/settings':                              () => import('../pages/Settings'),
  '/suppliers':                             () => import('../pages/p2p/p2p-master-management/supplier-management/Vendors'),
};

/* Routes whose path carries a parameter. The PARAM does not change the chunk —
   /employee/1 and /employee/2 are one module — so they prefetch like any other
   route, they just cannot be looked up by exact string.
 *
 * /master/:slug and /clm/:slug matter most: those are whole menu sections, so
 * without this every one of the ~50 master links and every CLM link silently
 * missed. Scan landings (/s/:key, /ps/:scanKey, /putaway-scan/:taskId) and the
 * public /onboarding/:token are left out — they are reached from a QR code or
 * an emailed link, never from the nav. */
const PATTERNS: [RegExp, string, () => Promise<unknown>][] = [
  [/^\/master\/[^/]+$/,                      'master',        () => import('../pages/master/MasterPage')],
  [/^\/clm\/[^/]+$/,                         'clm',           () => import('../pages/clm/shared/ClmStubPage')],
  [/^\/products\/[^/]+$/,                    'productView',   () => import('../pages/p2p/p2p-master-management/product-management/ProductView')],
  [/^\/hr\/recruitment\/[^/]+\/candidates$/, 'candidates',    () => import('../pages/recruitment/HrCandidates')],
  [/^\/hr\/doc-templates\/[^/]+\/edit$/,     'tplEdit',       () => import('../pages/hrms/doc-templates/TemplateForm')],
  [/^\/hr\/doc-templates\/[^/]+\/generate$/, 'tplGenerate',   () => import('../pages/hrms/doc-templates/GenerateDocument')],
  [/^\/inbox\/po-approval\/[^/]+$/,          'poApproval',    () => import('../pages/p2p/purchase-management/order/gst-approval/PoGstApprovalReview')],
  [/^\/sales\/matrix\/[^/]+\/stage\/[^/]+$/, 'salesMatrix',   () => import('../pages/sales/opportunity-pipeline/matrix/SalesMatrixDetail')],
];

/* Prefetched or in flight. import() dedupes anyway; this skips the bookkeeping
   and keeps the idle walk from re-queueing what it already did. Patterns are
   recorded under their own name, not the path, so /master/countries warming
   MasterPage also settles /master/states. */
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
  const clean = path.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';

  // Exact path first, then the parameterised ones.
  let key = clean;
  let load = ROUTES[clean];
  if (!load) {
    const hit = PATTERNS.find(([re]) => re.test(clean));
    if (!hit) return;
    key = 'pattern:' + hit[1];
    load = hit[2];
  }
  if (done.has(key)) return;
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

/**
 * Warm a whole menu group — what a click on a parent nav item means.
 *
 * Clicking "HRMS" only expands the submenu, and a parent item's link is "/#",
 * so the per-link hover never fires for it. But the click is a clear signal
 * about where the user is going, so queue that group's leaves through the same
 * idle walk: one at a time, lowest priority, unknown paths ignored.
 */
export function prefetchGroup(items?: { link?: string | null }[] | null): void {
  if (!items?.length) return;
  startIdlePrefetch(
    items.map((i) => i?.link || '').filter((l) => l && l !== '/#'),
  );
}
/** Paths this build can prefetch — used to skip work on unknown links. */
export const isPrefetchable = (path?: string | null): boolean => {
  if (!path) return false;
  const clean = path.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  return !!ROUTES[clean] || PATTERNS.some(([re]) => re.test(clean));
};
