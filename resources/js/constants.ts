import type { MenuItem, MenuGroup, UserRole } from './types';

/**
 * Feature flags — flip these on/off without touching menu or route plumbing.
 * Lifecycle: keep a feature `false` while it's in build/QA, flip to `true`
 * when ready to expose to users. The flag controls BOTH the sidebar entry
 * (filtered in HR_GROUPS below) and the React route (in components/App.tsx).
 *
 * When a feature is disabled:
 *   - Menu item is hidden from the sidebar
 *   - Direct URL navigation falls back to the dashboard
 */
export const FEATURE_FLAGS = {
  hrAttendance: true,    // HR · Time & Pay · Attendance
};

// Masters the super admin actually uses. Tenant-scoped masters (everything
// else) stay available to client/branch users via the standard per-module
// permission flags in `perms[id].can_view`.
export const SUPER_ADMIN_MASTERS: ReadonlySet<string> = new Set([
  'master.organization_types',
  'master.countries',
  'master.states',
  'master.state_codes',
  'master.address_types',
]);

export const MASTER_GROUPS: MenuGroup[] = [
  {
    id: 'master.identity',
    label: 'Identity & Entity',
    icon: 'IdCard',
    children: [
      { id: 'master.organization_types', icon: 'Building',    label: 'Organization Types' },
      { id: 'master.legal_entities', icon: 'Landmark',    label: 'Legal Entities' },
      { id: 'master.company',        icon: 'Building',    label: 'Company Details' },
      { id: 'master.bank_accounts',  icon: 'Landmark',    label: 'Bank Accounts' },
      { id: 'master.departments',    icon: 'Building2',   label: 'Departments' },
      { id: 'master.roles',          icon: 'UserCog',     label: 'Roles' },
      { id: 'master.designations',   icon: 'BadgeCheck',  label: 'Designations' },
      { id: 'master.kpis',           icon: 'Activity',    label: 'KPI Master' },
    ],
  },
  {
    id: 'master.geography',
    label: 'Geography & Location',
    icon: 'Globe',
    children: [
      { id: 'master.countries',          icon: 'Globe2', label: 'Countries' },
      { id: 'master.states',             icon: 'Map',    label: 'States' },
      { id: 'master.state_codes',        icon: 'Hash',   label: 'State Codes' },
      { id: 'master.address_types',      icon: 'Home',   label: 'Address Types' },
      { id: 'master.port_of_loading',    icon: 'Anchor', label: 'Ports of Loading' },
      { id: 'master.port_of_discharge',  icon: 'Ship',   label: 'Ports of Discharge' },
    ],
  },
  {
    id: 'master.trade',
    label: 'Trade & Commercial',
    icon: 'TrendingUp',
    children: [
      { id: 'master.segments',           icon: 'Target',     label: 'Segments' },
      { id: 'master.hsn_codes',          icon: 'Binary',     label: 'HSN Codes' },
      { id: 'master.gst_percentage',     icon: 'Percent',    label: 'GST Percentages' },
      { id: 'master.currencies',         icon: 'DollarSign', label: 'Currencies' },
      { id: 'master.uom',                icon: 'Ruler',      label: 'Units of Measurement' },
      { id: 'master.packaging_material', icon: 'Package',    label: 'Packaging Materials' },
      { id: 'master.conditions',         icon: 'Leaf',       label: 'Product Conditions' },
      { id: 'master.incoterms',          icon: 'Handshake',  label: 'Incoterms' },
    ],
  },
  {
    id: 'master.party',
    label: 'Party & Classification',
    icon: 'Users',
    children: [
      { id: 'master.customer_types',           icon: 'UserSquare', label: 'Customer Types' },
      { id: 'master.customer_classifications', icon: 'Award',      label: 'Customer Classifications' },
      { id: 'master.vendor_types',             icon: 'Store',      label: 'Supplier Types' },
      { id: 'master.vendor_behaviour',         icon: 'Activity',   label: 'Supplier Behaviour' },
      { id: 'master.applicable_types',         icon: 'Users2',     label: 'Applicable Parties' },
    ],
  },
  {
    id: 'master.legal',
    label: 'Legal & Compliance',
    icon: 'Scale',
    children: [
      { id: 'master.license_name',          icon: 'FileBadge',     label: 'License Types' },
      { id: 'master.risk_levels',           icon: 'Zap',           label: 'Risk Levels' },
      { id: 'master.document_type',         icon: 'FileText',      label: 'Document Types' },
      { id: 'master.haz_class',             icon: 'AlertTriangle', label: 'Hazard Classifications' },
      { id: 'master.compliance_behaviours', icon: 'Scale',         label: 'Compliance Behaviours' },
    ],
  },
  {
    id: 'master.operations',
    label: 'Operations & Support',
    icon: 'Wrench',
    children: [
      { id: 'master.assets',           icon: 'Briefcase',     label: 'Assets' },
      { id: 'master.asset_categories', icon: 'Tags',          label: 'Asset Categories' },
      { id: 'master.expense_category', icon: 'IndianRupee',   label: 'Expense Categories' },
    ],
  },
  {
    id: 'master.p2p',
    label: 'P2P Masters',
    icon: 'Handshake',
    children: [
      { id: 'master.payment_terms',          icon: 'CalendarDays', label: 'Payment Terms' },
      { id: 'master.approval_authority',     icon: 'ShieldCheck',  label: 'Approval Authority' },
      { id: 'master.procurement_category',   icon: 'Boxes',        label: 'Procurement Category' },
      { id: 'master.sourcing_type',          icon: 'Tag',          label: 'Sourcing Type' },
      { id: 'master.deviation_reason',       icon: 'AlertOctagon', label: 'Deviation Reason' },
      { id: 'master.match_exception',        icon: 'GitCompare',   label: 'Match Exception Type' },
      { id: 'master.advance_payment_rules',  icon: 'CreditCard',   label: 'Advance Payment Rules' },
      { id: 'master.exchange_rate_log',      icon: 'Repeat',       label: 'Exchange Rate Log' },
      { id: 'master.goods_service_flag',     icon: 'ToggleRight',  label: 'Goods vs Service Flag' },
      { id: 'master.vendor_directory',       icon: 'BookUser',     label: 'Supplier Directory' },
    ],
  },
  {
    id: 'master.warehouse',
    label: 'Warehouse Masters',
    icon: 'Warehouse',
    children: [
      { id: 'master.warehouse_master',  icon: 'Warehouse',   label: 'Warehouse Master' },
      { id: 'master.zone_master',       icon: 'Grid3x3',     label: 'Zone Master' },
      { id: 'master.rack_type_master',  icon: 'Layers',      label: 'Rack Type Master' },
      { id: 'master.temp_class_master', icon: 'Thermometer', label: 'Temperature Class' },
      { id: 'master.racks',             icon: 'Rows3',       label: 'Rack & Location' },
      { id: 'master.shelf_master',      icon: 'Rows4',       label: 'Shelf / Level' },
      { id: 'master.digital_twin',      icon: 'Monitor',     label: 'Digital Twin' },
      { id: 'master.freezers',          icon: 'Snowflake',   label: 'Freezer Management' },
    ],
  },
  // Attendance Master Management — branch-level configuration of leave
  // categories & leave plans. Visibility on this dashboard is permission-
  // driven; the matching HR_GROUPS entry below mirrors these leaves into the
  // branch-only HR sidebar.
  {
    id: 'master.attendance',
    label: 'Attendance Master Management',
    icon: 'CalendarCheck',
    children: [
      { id: 'master.leave_type', icon: 'CalendarOff',   label: 'Leave Type Master' },
      { id: 'master.leave_plan', icon: 'CalendarRange', label: 'Leave Plan Master' },
    ],
  },
];

export const HR_GROUPS: MenuGroup[] = [
  {
    id: 'hr.command',
    label: 'HRMS Command Center',
    icon: 'LayoutDashboard',
    children: [
      { id: 'hr.overview',  icon: 'LayoutGrid',     label: 'HRMS Overview' },
      { id: 'hr.pip',       icon: 'ClipboardCheck', label: 'PIP' },
      { id: 'hr.reports',   icon: 'BarChart3',      label: 'HR Reports' },
    ],
  },
  {
    id: 'hr.core',
    label: 'HR Core',
    icon: 'Users',
    children: [
      { id: 'hr.recruitment', icon: 'UserPlus',  label: 'Recruitment' },
      { id: 'hr.employee',    icon: 'User',      label: 'Employee' },
      { id: 'hr.onboarding',  icon: 'UserCheck', label: 'Employee Onboarding' },
      { id: 'hr.exit',        icon: 'LogOut',    label: 'Exit Management' },
    ],
  },
  {
    id: 'hr.time_pay',
    label: 'Time & Pay Inputs',
    icon: 'IndianRupee',
    children: [
      { id: 'hr.payroll',            icon: 'IndianRupee',   label: 'Payroll' },
      { id: 'hr.calculation_master', icon: 'Calculator',    label: 'Calculation Master' },
      ...(FEATURE_FLAGS.hrAttendance
        ? [{ id: 'hr.attendance', icon: 'CalendarCheck', label: 'Attendance' } as MenuItem]
        : []),
      { id: 'hr.leave',              icon: 'CalendarOff',   label: 'Leave' },
      { id: 'hr.leave_approvals',    icon: 'BadgeCheck',    label: 'Leave Approvals' },
      { id: 'hr.expense',            icon: 'Receipt',       label: 'Expense Management' },
    ],
  },
  {
    id: 'hr.documents',
    label: 'Document & Evidence',
    icon: 'FileText',
    children: [
      { id: 'hr.broadcast', icon: 'Megaphone', label: 'Broadcast Centre' },
      // Document Templates — role-based document templates (Offer Letter,
      // NDA, etc) with lifecycle triggers (sourced from trigger_point master)
      // + signing workflows + Tiptap web editor / MS Word DOCX round-trip.
      { id: 'hr.doc_templates', icon: 'FileText', label: 'Document Templates' },
      // Custom Fields — variables defined here are NOT in employee data; the
      // template engine prompts for them manually at generation time.
      { id: 'hr.custom_fields', icon: 'Star', label: 'Custom Fields' },
      // Trigger Point Master — branch-only master defining lifecycle trigger
      // modules (Onboarding, Offboarding, Event-Based) used by Doc Generation
      // Rules. Routes through /master/trigger_point (master.* convention).
      { id: 'master.trigger_point', icon: 'Zap', label: 'Trigger Point Master' },
    ],
  },
  // Attendance Master Management — branch-only configuration of leave
  // categories & leave plans. Items use `master.*` ids so they leverage the
  // generic MasterController + MasterPage shell (CRUD + delete confirm + toast).
  {
    id: 'master.attendance',
    label: 'Attendance Master Management',
    icon: 'CalendarCheck',
    children: [
      { id: 'master.leave_type', icon: 'CalendarOff',   label: 'Leave Type Master' },
      { id: 'master.leave_plan', icon: 'CalendarRange', label: 'Leave Plan Master' },
    ],
  },
];

// Sales Matrix sidebar — branch-and-below only. Super admin and client admin
// hold the perms purely as granters (so they can cascade down to branches);
// the sidebar entry is gated to branch_user / employee so the menu never
// surfaces for the granter roles. Inside the group, per-leaf visibility still
// follows perms[id].can_view (Sidebar.canView).
export const SALES_GROUPS: MenuGroup[] = [
  {
    id: 'sales.insights',
    label: 'Sales Insights & Productivity',
    icon: 'BarChart3',
    children: [
      { id: 'sales.analytics',            icon: 'BarChart3',      label: 'Sales Analytics' },
      { id: 'sales.productivity_tracker', icon: 'ClipboardCheck', label: 'Productivity Tracker' },
      { id: 'sales.p2p_summary',          icon: 'ShoppingBag',    label: 'Procure to Pay (P2P) Summary' },
    ],
  },
  {
    id: 'sales.core',
    label: 'Sales Core (Masters)',
    icon: 'Database',
    children: [
      { id: 'sales.customers',       icon: 'UserSquare', label: 'Customers' },
      { id: 'sales.consignee',       icon: 'Truck',      label: 'Consignee' },
      { id: 'sales.lead_ack_master', icon: 'BadgeCheck', label: 'Lead Acknowledgement Master' },
    ],
  },
  {
    id: 'sales.operations',
    label: 'Sales Matrix Operations',
    icon: 'Activity',
    /* Per product call (Vedant, 22-May-26): keep only two leaves under
     * Sales Matrix Operations — My Workplace and Quotation Vs PI History.
     * Lead Distribution / Lead Detail / Enquiries / Leads Details were
     * moved out / superseded by other modules, so we drop them from the
     * sidebar to avoid dead nav entries. Their pages still exist on
     * disk and are reachable by direct URL; only the menu surface is
     * trimmed here. */
    children: [
      { id: 'sales.workplace',       icon: 'Activity', label: 'My Workplace' },
      { id: 'sales.quotation_vs_pi', icon: 'FileText', label: 'Quotation Vs PI History' },
    ],
  },
];

// Central CLM tree — mirrors the SalesMatrix_v4_9 CLM landing page.
// The sidebar flattens the legacy two-level visual into a single nesting
// level (one MenuGroup per logical cluster); the labels keep the legacy
// dotted prefix so the user recognises the original layout.
export const CLM_GROUPS: MenuGroup[] = [
  {
    id: 'clm.command',
    label: 'CLM Command Center',
    icon: 'LayoutDashboard',
    children: [
      { id: 'clm.analytics',          icon: 'BarChart3',      label: 'CLM Analytics' },
      { id: 'clm.diagnosis',          icon: 'Stethoscope',    label: 'Diagnosis View' },
      { id: 'clm.resolution_center',  icon: 'Wrench',         label: 'Resolution Center' },
    ],
  },
  {
    id: 'clm.ops_with',
    label: 'CLM Operations — With Shipment ID',
    icon: 'Truck',
    children: [
      { id: 'clm.buyer_profile',      icon: 'User',           label: 'Buyer Profile' },
      { id: 'clm.supplier_profile',   icon: 'Truck',          label: 'Supplier Profile' },
    ],
  },
  {
    id: 'clm.ops_without',
    label: 'CLM Operations — Without Shipment ID',
    icon: 'FileText',
    children: [
      { id: 'clm.case_to_case',          icon: 'FileText',     label: 'Case to Case Contracts' },
      { id: 'clm.agreements_sent',       icon: 'Send',         label: 'Agreements We Sent' },
      { id: 'clm.agreements_to_approve', icon: 'CheckCircle',  label: 'Agreements To Approve' },
    ],
  },
  {
    id: 'clm.compliance',
    label: 'Compliance & Regulatory',
    icon: 'ShieldCheck',
    children: [
      { id: 'clm.segment',         icon: 'LayoutGrid',  label: 'Segment' },
      { id: 'clm.authority',       icon: 'Award',       label: 'Authority' },
      { id: 'clm.quality_docs',    icon: 'CheckSquare', label: 'Quality & Compliance Docs' },
      { id: 'clm.kyc',             icon: 'UserCheck',   label: 'KYC' },
      { id: 'clm.due_diligence',   icon: 'Search',      label: 'Due Diligence (DD)' },
      { id: 'clm.trade_licenses',  icon: 'FileBadge',   label: 'Trade Licenses' },
    ],
  },
  {
    id: 'clm.documents',
    label: 'Contract & Document Masters',
    icon: 'BookOpen',
    children: [
      { id: 'clm.document_panel',    icon: 'PenSquare',  label: 'Document Control Panel' },
      { id: 'clm.trade_documents',   icon: 'Hexagon',    label: 'Trade Documents' },
      { id: 'clm.agreements',        icon: 'Users',      label: 'Agreements' },
      { id: 'clm.terms_conditions',  icon: 'List',       label: 'Terms & Conditions' },
      { id: 'clm.clause_library',    icon: 'BookOpen',   label: 'Clause Library' },
    ],
  },
];

// Role alias — keeps menu-item declarations readable. Covers every tenant
// user type plus super_admin, so any item declared with this role list is
// visible to everyone (visibility within the group is then narrowed by
// per-module permission flags inside Sidebar.canView).
const ALL_TENANT_ROLES: UserRole[] = ['super_admin', 'client_admin', 'client_user', 'branch_user', 'employee'];

export const MENU_ITEMS: MenuItem[] = [
  { id: '', section: 'MAIN', label: '', icon: '', roles: ALL_TENANT_ROLES },
  { id: 'dashboard', icon: 'LayoutGrid', label: 'Dashboard', roles: ALL_TENANT_ROLES },

  { id: '', section: 'MANAGEMENT', label: '', icon: '', roles: ['super_admin'] },
  { id: 'clients', icon: 'Building2', label: 'Clients', roles: ['super_admin'] },

  { id: '', section: 'BILLING', label: '', icon: '', roles: ['super_admin'] },
  { id: 'plans', icon: 'CreditCard', label: 'Plans', roles: ['super_admin'] },
  { id: 'payments', icon: 'IndianRupee', label: 'Payments', roles: ['super_admin'] },

  { id: '', section: 'OPERATIONS', label: '', icon: '', roles: ['client_admin'] },
  { id: 'branches', icon: 'GitBranch', label: 'Branches', roles: ['client_admin'] },
  // Legacy top-level "Employees" menu was removed — HR > Employees (under
  // the HR group) is the single source of truth now.

  { id: '', section: 'BILLING', label: '', icon: '', roles: ['client_admin'] },
  { id: 'my-plan', icon: 'CreditCard', label: 'My Plan', roles: ['client_admin'] },

  { id: '', section: 'MASTER DATA', label: '', icon: '', roles: ALL_TENANT_ROLES },
  {
    id: 'master',
    icon: 'Database',
    label: 'Master',
    roles: ALL_TENANT_ROLES,
    groups: MASTER_GROUPS,
  },
  {
    id: 'hr',
    icon: 'Users',
    label: 'HR',
    // Branch users + employees — super_admin and client_admin manage at the
    // tenant level (Clients / Plans / Settings) and don't need the day-to-day
    // employee / leave / payroll menus, so the sidebar entry is hidden for
    // them (direct URLs still work). Employees see HR only when a branch admin
    // has granted them can_view on at least one hr.* leaf: hasAnyHrView()
    // gates the group and buildHrSubItems() filters to the granted leaves —
    // identical to how the Sales Matrix and CLM groups already work.
    roles: ['branch_user', 'employee'],
    groups: HR_GROUPS,
  },
  {
    id: 'sales',
    icon: 'TrendingUp',
    label: 'Sales Matrix',
    // Branch + employee only — super_admin and client_admin hold the perm
    // rows purely so they can cascade-grant down (super_admin → client_admin
    // → branch_user → employee, enforced in PermissionController), but
    // neither role works inside Sales Matrix. Hiding the entry here matches
    // the product call: granters don't get a menu they'd never use.
    roles: ['branch_user', 'employee'],
    groups: SALES_GROUPS,
  },
  {
    id: 'clm',
    icon: 'FileText',
    label: 'Central CLM',
    // Same role gate as Sales Matrix — operational module surfaces only on
    // branch_user + employee; the higher tiers grant down. Per-leaf
    // visibility flows from `perms[id].can_view` in Sidebar.canView, so
    // branch admins decide which CLM modules each employee sees.
    roles: ['branch_user', 'employee'],
    groups: CLM_GROUPS,
  },

  // Products catalog — branch + employee only. Amazon/Flipkart-style card
  // grid with a 6-step Add Product wizard. No permission flag yet so the
  // entry surfaces purely on user_type (handled in LayoutMenuData via the
  // defaultSlugs allow-list).
  { id: 'products', icon: 'Package', label: 'Products', roles: ['branch_user', 'employee'] },

  // Vendor master — companies the branch buys product from. Sits next to
  // Products so the purchasing trio (Products → Vendors → mappings) reads
  // as a single section in the sidebar.
  { id: 'vendors',  icon: 'Store',   label: 'Suppliers',  roles: ['branch_user', 'employee'] },

  // Face-driven attendance — only employees punch in. The signed-in admin /
  // branch user has no Employee row to clock in for; surfaced ONLY to the
  // employee role so admins don't see a dead-end menu entry.
  { id: 'clock-in', icon: 'CalendarCheck', label: 'Clock-In', roles: ['employee'] },

  // Permissions panel — only admins should grant. Employees never manage
  // their peers' access, so no `employee` here.
  { id: '', section: 'ACCESS CONTROL', label: '', icon: '', roles: ['super_admin', 'client_admin', 'branch_user'] },
  { id: 'permissions', icon: 'ShieldCheck', label: 'Permissions', roles: ['super_admin', 'client_admin', 'branch_user'] },

  { id: '', section: 'SYSTEM', label: '', icon: '', roles: ALL_TENANT_ROLES },
  { id: 'settings', icon: 'Settings', label: 'Settings', roles: ['super_admin'] },
  { id: 'profile', icon: 'UserCircle', label: 'Profile', roles: ALL_TENANT_ROLES },
];
