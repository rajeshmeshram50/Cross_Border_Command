/* ─────────────────────────────────────────────────────────────────────────
 * Global route-access guard.
 *
 * The sidebar (LayoutMenuData) and header (IdimsHeader) only *hide* menu items
 * a user can't reach — they do NOT stop someone pasting a restricted URL into
 * the address bar. Without a guard, a Dashboard-only employee who types
 * `/hr/employees` lands on the real page (rendered passively read-only) instead
 * of being blocked.
 *
 * `canAccessPath` closes that hole. It re-derives, for a given pathname, the
 * SAME visibility decision the menu makes, so the two never drift:
 *   - platform modules (clients / plans / payments / master / permissions) → super_admin
 *   - account modules (branches / master / permissions / my-plan)          → client_admin
 *   - business modules (HR / Sales / CLM / P2P / GTS / Inventory / Dev …)   → branch_user
 *     & employee, gated per-leaf on the exact `perms['<slug>'].can_view` grant
 *   - self / utility pages (dashboard, profile, settings, my-team, inbox …) → any role
 *
 * Policy (chosen for this guard): STRICT menu parity for every role, and
 * FAIL-CLOSED inside known module prefixes — any /hr, /sales, /clm, /p2p,
 * /master, /clients, … path that doesn't resolve to a granted slug is denied.
 * Paths outside every known prefix fall through as ALLOWED so genuine 404s
 * still hit React Router's `*` → /dashboard redirect instead of a false block.
 * ───────────────────────────────────────────────────────────────────────── */

type PermRow = { can_view?: boolean } | undefined;

interface GuardUser {
  user_type?: string;
  permissions?: Record<string, PermRow>;
}

// Self / utility pages every authenticated role may open. These back the
// always-present header affordances (profile menu, inbox/gmail/clock-in
// action buttons) — blocking them would deny users their own chrome.
const ALWAYS_ALLOW = new Set<string>([
  '/dashboard',
  '/profile',
  '/my-plan',
  '/plan-blocked',
  '/settings',
  '/my-team',
  '/inbox',
  '/gmail',
  '/clock-in',
]);

// Business-module routes → the exact permission slug the menu gates each leaf
// on. Sub-routes (detail / edit / nested) resolve via HR_PREFIX_LEAF below.
const HR_LEAF: Record<string, string> = {
  '/hr/overview': 'hr.overview',
  '/hr/employees': 'hr.employee',
  '/hr/recruitment': 'hr.recruitment',
  '/hr/exit-management': 'hr.exit',
  '/hr/employee-onboarding': 'hr.onboarding',
  '/hr/attendance': 'hr.attendance',
  '/hr/leave': 'hr.leave',
  '/hr/leave-plans': 'hr.leave',
  '/hr/leave-approvals': 'hr.leave_approvals',
  '/hr/holiday': 'hr.holiday',
  '/hr/pip': 'hr.pip',
  '/hr/expense': 'hr.expense',
  '/hr/payroll': 'hr.payroll',
  '/hr/broadcast': 'hr.broadcast',
  '/hr/doc-templates': 'hr.doc_templates',
  '/hr/custom-fields': 'hr.custom_fields',
};
const HR_PREFIX_LEAF: Array<[string, string]> = [
  ['/hr/employees/', 'hr.employee'],       // /:id/permissions, /:id/profile
  ['/hr/recruitment/', 'hr.recruitment'],  // /:id/candidates
  ['/hr/doc-templates/', 'hr.doc_templates'], // /new, /:id/edit, /:id/generate
];

// Sales leaves: some paths accept any-of several slugs (a page shared by two
// menu leaves, or one that rides on another leaf's grant).
const SALES_LEAF: Record<string, string[]> = {
  '/sales/customers': ['sales.customers'],
  '/sales/consignee': ['sales.consignee'],
  '/sales/lead-ack-master': ['sales.lead_ack_master'],
  '/sales/lead-worksheet': ['sales.workplace'],
  '/sales/todo': ['sales.productivity_tracker'],
  '/sales/qpi': ['sales.quotation_vs_pi'],
  '/sales/sign-tracker': ['sales.quotation_vs_pi', 'sales.sign_tracker'],
  '/sales/p2p-summary': ['sales.p2p_summary', 'p2p.sales_summary'],
  '/sales/diagnosis': ['sales.diagnosis'],
  '/sales/resolution-center': ['sales.resolution_center'],
  '/sales/analytics': ['sales.analytics'],
  '/sales/performance': ['sales.performance'],
};

const CLM_LEAF: Record<string, string> = {
  '/clm/analytics': 'clm.analytics',
  '/clm/diagnosis-resolution': 'clm.diagnosis_resolution',
  '/clm/regulatory-defense': 'clm.regulatory_defense',
  '/clm/buyer-profile': 'clm.buyer_profile',
  '/clm/supplier-profile': 'clm.supplier_profile',
  '/clm/case-to-case': 'clm.case_to_case',
  '/clm/agreements-sent': 'clm.agreements_sent',
  '/clm/agreements-to-approve': 'clm.agreements_to_approve',
  '/clm/segment': 'clm.segment',
  '/clm/authority': 'clm.authority',
  '/clm/quality-docs': 'clm.quality_docs',
  '/clm/kyc': 'clm.kyc',
  '/clm/due-diligence': 'clm.due_diligence',
  '/clm/trade-licenses': 'clm.trade_licenses',
  '/clm/document-panel': 'clm.document_panel',
  '/clm/trade-documents': 'clm.trade_documents',
  '/clm/agreements': 'clm.agreements',
  '/clm/terms-conditions': 'clm.terms_conditions',
  '/clm/clause-library': 'clm.clause_library',
};

const P2P_LEAF: Record<string, string> = {
  '/p2p/analytics': 'p2p.analytics',
  '/p2p/diagnosis': 'p2p.diagnosis',
  '/p2p/bulk-sourcing': 'p2p.bulk_sourcing',
  '/p2p/case-to-case': 'p2p.case_to_case',
  '/p2p/purchase-order': 'p2p.po',
  '/p2p/supplier-purchase-invoice': 'p2p.spi',
};

// Known module prefixes — a path under any of these that fails to resolve to a
// grant is DENIED (fail-closed), rather than falling through to "allow".
const GUARDED_PREFIXES = [
  '/clients', '/branches', '/plans', '/payments', '/permissions', '/master',
  '/hr', '/sales', '/clm', '/p2p', '/products', '/suppliers', '/vendors',
  '/gts', '/inventory', '/credentials-vault', '/project-navigator', '/developers',
];

export function canAccessPath(pathname: string, user: GuardUser | null | undefined): boolean {
  if (!user) return false;

  // Normalise: drop query/hash (pathname has none, but be defensive) + trailing slash.
  let path = (pathname || '/').split('?')[0].split('#')[0];
  if (path.length > 1 && path.endsWith('/')) path = path.replace(/\/+$/, '');

  const role = user.user_type || '';
  const isSuper = role === 'super_admin';
  const isClientAdmin = role === 'client_admin';
  const isBranchUser = role === 'branch_user';
  const isEmployee = role === 'employee';
  // Audience for the day-to-day business modules. Admins are intentionally
  // excluded — the menu never surfaces these to them (they hold grant rows
  // only to cascade access downstream).
  const isBiz = isBranchUser || isEmployee;

  const perms = user.permissions || {};
  const leaf = (slug: string) => !!perms[slug]?.can_view;
  const anyLeaf = (slugs: string[]) => slugs.some(leaf);
  const group = (prefix: string) =>
    Object.keys(perms).some((s) => s.startsWith(prefix) && perms[s]?.can_view);

  // 1) Self / utility pages — every role.
  if (ALWAYS_ALLOW.has(path)) return true;

  // 2) Platform modules — super_admin only.
  if (path === '/clients' || path.startsWith('/clients/')) return isSuper;
  if (path === '/plans' || path.startsWith('/plans/')) return isSuper;
  // Payments: super_admin + the client_admin who settles the bills (mirrors the
  // existing explicit route guard in App.tsx).
  if (path === '/payments') return isSuper || isClientAdmin;

  // 3) Account modules — client_admin.
  if (path === '/branches' || path.startsWith('/branches/')) return isClientAdmin;
  // Permissions: super_admin / client_admin / branch_user grant access; employees never.
  if (path === '/permissions') return isSuper || isClientAdmin || isBranchUser;

  // 4) Master — admins get the whole area; tenants need a master.* grant.
  //    MasterPage self-guards the specific leaf, so module-level access is enough here.
  if (path === '/master' || path.startsWith('/master/')) {
    return isSuper || isClientAdmin || group('master.');
  }

  // 5) Business modules — branch_user / employee, gated per leaf.
  if (path === '/hr') return isBiz && group('hr.');
  if (path.startsWith('/hr/')) {
    if (!isBiz) return false;
    if (path in HR_LEAF) return leaf(HR_LEAF[path]);
    const hit = HR_PREFIX_LEAF.find(([p]) => path.startsWith(p));
    return hit ? leaf(hit[1]) : false;
  }

  if (path === '/sales' || path.startsWith('/sales/')) {
    if (!isBiz) return false;
    if (path in SALES_LEAF) return anyLeaf(SALES_LEAF[path]);
    // Hub, matrix detail, and the un-slugged operational pages ride on "any
    // Sales grant" — the same rule that shows the Sales Matrix parent menu.
    return group('sales.');
  }

  if (path === '/clm') return isBiz && group('clm.');
  if (path.startsWith('/clm/')) {
    if (!isBiz) return false;
    if (path in CLM_LEAF) return leaf(CLM_LEAF[path]);
    return group('clm.'); // stub leaves fall through to the shared CLM stub page
  }

  if (path === '/p2p') return isBiz && (leaf('p2p') || group('p2p.'));
  if (path.startsWith('/p2p/')) {
    if (!isBiz) return false;
    return path in P2P_LEAF ? leaf(P2P_LEAF[path]) : false;
  }

  // 6) Single-page business modules.
  if (path === '/gts') return isBiz && leaf('gts');
  if (path === '/inventory') return isBiz && leaf('inventory');
  if (path === '/credentials-vault') return isBiz && leaf('credentials-vault');
  if (path === '/project-navigator') return isBiz && leaf('project-navigator');
  if (path === '/developers' || path.startsWith('/developers/')) {
    return isBiz && leaf('developers.shipment');
  }

  // 7) Products / Suppliers — default modules every tenant business user holds.
  if (path === '/products' || path.startsWith('/products/')) return isBiz;
  if (path === '/suppliers' || path === '/vendors' || path.startsWith('/vendors/')) return isBiz;

  // 8) Anything under a guarded prefix that didn't resolve above → fail-closed.
  if (GUARDED_PREFIXES.some((p) => path === p || path.startsWith(p + '/'))) {
    return false;
  }

  // 9) Unknown path outside every module — allow through so React Router's
  //    catch-all (`*` → /dashboard) handles it instead of a false Access Denied.
  return true;
}
