type PermRow = { can_view?: boolean } | undefined;

interface GuardUser {
  user_type?: string;
  permissions?: Record<string, PermRow>;
}

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

const HR_LEAF: Record<string, string> = {
  '/hr/overview': 'hr.overview',
  '/hr/employees': 'hr.employee',
  '/hr/recruitment': 'hr.recruitment',
  '/hr/exit-management': 'hr.exit',
  '/hr/employee-onboarding': 'hr.onboarding',
  '/hr/attendance': 'hr.attendance',
  '/hr/devices': 'hr.attendance',
  '/hr/regularization-requests': 'hr.attendance',
  '/hr/leave': 'hr.leave',
  '/hr/leave-plans': 'hr.leave',
  '/hr/leave-approvals': 'hr.leave',
  '/hr/holiday': 'hr.holiday',
  '/hr/pip': 'hr.pip',
  '/hr/expense': 'hr.expense',
  '/hr/payroll': 'hr.payroll',
  '/hr/broadcast': 'hr.broadcast',
  '/hr/doc-templates': 'hr.doc_templates',
  '/hr/custom-fields': 'hr.custom_fields',
};
const HR_PREFIX_LEAF: Array<[string, string]> = [
  ['/hr/employees/', 'hr.employee'],
  ['/hr/recruitment/', 'hr.recruitment'],
  ['/hr/doc-templates/', 'hr.doc_templates'],
];

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
  '/p2p/sourcing-tracker': 'p2p.bulk_sourcing',
  '/p2p/case-to-case': 'p2p.case_to_case',
  '/p2p/service-management': 'p2p.service',
  '/inventory-management/warehouse-master': 'master.warehouse_master',
  '/inventory-management/zone-master': 'master.zone_master',
  '/inventory-management/rack-master': 'master.racks',
  '/inventory-management/product-flags': 'master.warehouse_master',
  '/p2p/supplier-purchase-invoice': 'p2p.order',
  '/p2p/invoice': 'p2p.order',
  '/p2p/order': 'p2p.order',
  '/p2p/payment-request': 'p2p.payment_request',
  '/p2p/advance-refund-adjustment': 'p2p.order',
};

const GUARDED_PREFIXES = [
  '/clients', '/branches', '/plans', '/payments', '/permissions', '/master',
  '/hr', '/sales', '/clm', '/p2p', '/products', '/suppliers', '/vendors',
  '/gts', '/inventory', '/credentials-vault', '/project-navigator', '/developers',
];

export function canAccessPath(pathname: string, user: GuardUser | null | undefined): boolean {
  if (!user) return false;

  let path = (pathname || '/').split('?')[0].split('#')[0];
  if (path.length > 1 && path.endsWith('/')) path = path.replace(/\/+$/, '');

  const role = user.user_type || '';
  const isSuper = role === 'super_admin';
  const isClientAdmin = role === 'client_admin';
  const isBranchUser = role === 'branch_user';
  const isEmployee = role === 'employee';
  const isBiz = isBranchUser || isEmployee;

  const perms = user.permissions || {};
  const leaf = (slug: string) => !!perms[slug]?.can_view;
  const anyLeaf = (slugs: string[]) => slugs.some(leaf);
  const group = (prefix: string) =>
    Object.keys(perms).some((s) => s.startsWith(prefix) && perms[s]?.can_view);

  if (ALWAYS_ALLOW.has(path)) return true;
  if (path.startsWith('/inbox/')) return true;

  if (path === '/clients' || path.startsWith('/clients/')) return isSuper;
  if (path === '/plans' || path.startsWith('/plans/')) return isSuper;
  if (path === '/payments') return isSuper || isClientAdmin;

  if (path === '/branches' || path.startsWith('/branches/')) return isClientAdmin;
  if (path === '/permissions') return isSuper || isClientAdmin || isBranchUser || isEmployee;

  if (path === '/master' || path.startsWith('/master/')) {
    return isSuper || isClientAdmin || group('master.');
  }

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
    return group('sales.');
  }

  if (path === '/clm') return isBiz && group('clm.');
  if (path.startsWith('/clm/')) {
    if (!isBiz) return false;
    if (path in CLM_LEAF) return leaf(CLM_LEAF[path]);
    return group('clm.');
  }

  if (path === '/p2p') return isBiz && (leaf('p2p') || group('p2p.'));
  if (path.startsWith('/p2p/')) {
    if (!isBiz) return false;
    return path in P2P_LEAF ? leaf(P2P_LEAF[path]) : false;
  }

  if (path === '/gts') return isBiz && leaf('gts');
   if (path === '/inventory' || path.startsWith('/inventory/')) return true;
  if (path === '/credentials-vault' || path.startsWith('/credentials-vault/')) {
    return isClientAdmin || (isBiz && leaf('credentials-vault'));
  }
  if (path === '/project-navigator') return isBiz && leaf('project-navigator');
  if (path === '/developers' || path.startsWith('/developers/')) {
    return isBiz && leaf('developers.shipment');
  }

  if (path === '/products' || path.startsWith('/products/')) return isBiz;
  if (path === '/suppliers' || path === '/vendors' || path.startsWith('/vendors/')) return isBiz;

  if (GUARDED_PREFIXES.some((p) => path === p || path.startsWith(p + '/'))) {
    return false;
  }

   return true;
}
