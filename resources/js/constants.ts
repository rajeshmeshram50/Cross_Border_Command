import type { MenuItem, MenuGroup, UserRole } from './types';

export const FEATURE_FLAGS = {
  hrAttendance: true,
};

export const PF_WAGE_CEILING = 25000;
export const PF_RATE = 0.12;
export const PF_WAGE_CEILING_LABEL = `₹${PF_WAGE_CEILING.toLocaleString('en-IN')}`;
export const PF_MAX_LABEL = `₹${Math.round(PF_WAGE_CEILING * PF_RATE).toLocaleString('en-IN')}`;

export const PF_TYPE_OPTIONS = [
  { value: 'Statutory', label: `Statutory (₹${Math.round(PF_WAGE_CEILING / 1000)}k cap)` },
  { value: 'Standard',  label: 'Standard (full basic)' },
];

export const SESSION_TIMEOUT_HOURS = 2;
export const SESSION_TIMEOUT_MS    = SESSION_TIMEOUT_HOURS * 60 * 60 * 1000;
export const SESSION_TIMEOUT_LABEL = `${SESSION_TIMEOUT_HOURS} hours`;

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
      { id: 'master.organization_types', icon: 'Building', label: 'Organization Types' },
      { id: 'master.company', icon: 'Building', label: 'Company Details' },
      { id: 'master.bank_accounts', icon: 'Landmark', label: 'Bank Accounts' },
      { id: 'master.departments', icon: 'Building2', label: 'Departments' },
      { id: 'master.roles', icon: 'UserCog', label: 'Roles' },
      { id: 'master.designations', icon: 'BadgeCheck', label: 'Designations' },
      { id: 'master.kpis', icon: 'Activity', label: 'KPI Master' },
    ],
  },
  {
    id: 'master.geography',
    label: 'Geography & Location',
    icon: 'Globe',
    children: [
      { id: 'master.countries', icon: 'Globe2', label: 'Countries' },
      { id: 'master.states', icon: 'Map', label: 'States' },
      { id: 'master.state_codes', icon: 'Hash', label: 'State Codes' },
      { id: 'master.address_types', icon: 'Home', label: 'Address Types' },
      { id: 'master.port_of_loading', icon: 'Anchor', label: 'Ports of Loading' },
      { id: 'master.port_of_discharge', icon: 'Ship', label: 'Ports of Discharge' },
    ],
  },
  {
    id: 'master.trade',
    label: 'Trade & Commercial',
    icon: 'TrendingUp',
    children: [
      { id: 'master.segments', icon: 'Target', label: 'Segments' },
      { id: 'master.hsn_codes', icon: 'Binary', label: 'HSN Codes' },
      { id: 'master.gst_percentage', icon: 'Percent', label: 'GST Percentages' },
      { id: 'master.currencies', icon: 'DollarSign', label: 'Currencies' },
      { id: 'master.uom', icon: 'Ruler', label: 'Units of Measurement' },
      { id: 'master.packaging_material', icon: 'Package', label: 'Packaging Materials' },
      { id: 'master.conditions', icon: 'Leaf', label: 'Product Conditions' },
      { id: 'master.incoterms', icon: 'Handshake', label: 'Incoterms' },
    ],
  },
  {
    id: 'master.party',
    label: 'Party & Classification',
    icon: 'Users',
    children: [
      { id: 'master.customer_types', icon: 'UserSquare', label: 'Customer Types' },
      { id: 'master.customer_classifications', icon: 'Award', label: 'Customer Classifications' },
      { id: 'master.vendor_types', icon: 'Store', label: 'Supplier Types' },
      { id: 'master.vendor_behaviour', icon: 'Activity', label: 'Supplier Behaviour' },
      { id: 'master.applicable_types', icon: 'Users2', label: 'Applicable Parties' },
    ],
  },
  {
    id: 'master.legal',
    label: 'Legal & Compliance',
    icon: 'Scale',
    children: [
      { id: 'master.license_name', icon: 'FileBadge', label: 'License Types' },
      { id: 'master.risk_levels', icon: 'Zap', label: 'Risk Levels' },
      { id: 'master.document_type', icon: 'FileText', label: 'Document Types' },
      { id: 'master.haz_class', icon: 'AlertTriangle', label: 'Hazard Classifications' },
      { id: 'master.compliance_behaviours', icon: 'Scale', label: 'Compliance Behaviours' },
    ],
  },
  {
    id: 'master.operations',
    label: 'Operations & Support',
    icon: 'Wrench',
    children: [
      { id: 'master.assets', icon: 'Briefcase', label: 'Assets' },
      { id: 'master.asset_categories', icon: 'Tags', label: 'Asset Categories' },
      { id: 'master.expense_category', icon: 'IndianRupee', label: 'Expense Categories' },
    ],
  },
  {
    id: 'master.p2p',
    label: 'P2P Masters',
    icon: 'Handshake',
    children: [
      { id: 'master.payment_terms', icon: 'CalendarDays', label: 'Payment Terms' },
      { id: 'master.approval_authority', icon: 'ShieldCheck', label: 'Approval Authority' },
      { id: 'master.procurement_category', icon: 'Boxes', label: 'Procurement Category' },
      { id: 'master.sourcing_type', icon: 'Tag', label: 'Sourcing Type' },
      { id: 'master.deviation_reason', icon: 'AlertOctagon', label: 'Deviation Reason' },
      { id: 'master.match_exception', icon: 'GitCompare', label: 'Match Exception Type' },
      { id: 'master.advance_payment_rules', icon: 'CreditCard', label: 'Advance Payment Rules' },
      { id: 'master.exchange_rate_log', icon: 'Repeat', label: 'Exchange Rate Log' },
      { id: 'master.goods_service_flag', icon: 'ToggleRight', label: 'Goods vs Service Flag' },
      { id: 'master.vendor_directory', icon: 'BookUser', label: 'Supplier Directory' },
    ],
  },
  {
    id: 'master.warehouse',
    label: 'Warehouse Masters',
    icon: 'Warehouse',
    children: [
      { id: 'master.warehouse_master', icon: 'Warehouse', label: 'Warehouse Master' },
      { id: 'master.zone_master', icon: 'Grid3x3', label: 'Zone Master' },
      { id: 'master.rack_type_master', icon: 'Layers', label: 'Rack Type Master' },
      { id: 'master.temp_class_master', icon: 'Thermometer', label: 'Temperature Class' },
      { id: 'master.racks', icon: 'Rows3', label: 'Rack & Location' },
      { id: 'master.shelf_master', icon: 'Rows4', label: 'Shelf / Level' },
      { id: 'master.digital_twin', icon: 'Monitor', label: 'Digital Twin' },
      { id: 'master.freezers', icon: 'Snowflake', label: 'Freezer Management' },
    ],
  },
  {
    id: 'master.attendance',
    label: 'Attendance Master Management',
    icon: 'CalendarCheck',
    children: [
      { id: 'master.leave_type', icon: 'CalendarOff', label: 'Leave Type Master' },
      { id: 'master.leave_plan', icon: 'CalendarRange', label: 'Leave Plan Master' },
      { id: 'master.overtime_rates', icon: 'Timer', label: 'Overtime (OT) Master' },
    ],
  },
];

export const INVENTORY_GROUPS: MenuGroup[] = [
  {
    id: 'inv.master',
    label: 'Inventory Master',
    icon: 'Warehouse',
    children: [
      { id: 'master.warehouse_master', icon: 'Warehouse', label: 'Warehouse Master' },
      { id: 'master.zone_master', icon: 'Grid3x3', label: 'Zone Master' },
      { id: 'master.racks', icon: 'Rows3', label: 'Rack Master' },
      { id: 'master.product_flags', icon: 'Flag', label: 'Product Flags Master' },
    ],
  },
];

export const CREDVAULT_GROUPS: MenuGroup[] = [
  {
    id: 'cv.analytics',
    label: 'Vault Analytics',
    icon: 'LayoutDashboard',
    children: [
      { id: 'cv.dashboard', icon: 'LayoutDashboard', label: 'Vault Dashboard' },
      { id: 'cv.password_health', icon: 'HeartPulse', label: 'Password Health' },
    ],
  },
  {
    id: 'cv.management',
    label: 'Vault Management',
    icon: 'Lock',
    children: [
      { id: 'cv.my_vault', icon: 'Lock', label: 'My Vault' },
      { id: 'cv.team_vault', icon: 'Users', label: 'Team Vault' },
      { id: 'cv.critical_vault', icon: 'ShieldAlert', label: 'Critical Vault' },
    ],
  },
  {
    id: 'cv.admin',
    label: 'Vault Administration & Security',
    icon: 'ShieldCheck',
    children: [
      { id: 'cv.access_requests', icon: 'UserCheck', label: 'Access Request Management' },
      { id: 'cv.import_recovery', icon: 'DatabaseBackup', label: 'Import & Recovery' },
      { id: 'cv.audit_logs', icon: 'FileText', label: 'Audit Logs' },
      { id: 'cv.recycle_bin', icon: 'Trash2', label: 'Recycle Bin' },
    ],
  },
];

export const HR_GROUPS: MenuGroup[] = [
  {
    id: 'hr.command',
    label: 'HRMS Command Center',
    icon: 'LayoutDashboard',
    children: [
      { id: 'hr.overview', icon: 'LayoutGrid', label: 'HRMS Overview' },
    ],
  },
  {
    id: 'hr.core',
    label: 'HR Core',
    icon: 'Users',
    children: [
      { id: 'hr.recruitment', icon: 'UserPlus', label: 'Recruitment' },
      { id: 'hr.employee', icon: 'User', label: 'Employee' },
      { id: 'hr.onboarding', icon: 'UserCheck', label: 'Employee Onboarding' },
      { id: 'hr.exit', icon: 'LogOut', label: 'Exit Management' },
    ],
  },
  {
    id: 'hr.time_pay',
    label: 'Time & Pay Inputs',
    icon: 'IndianRupee',
    children: [
      { id: 'hr.payroll', icon: 'IndianRupee', label: 'Payroll' },
      ...(FEATURE_FLAGS.hrAttendance
        ? [
            { id: 'hr.attendance', icon: 'CalendarCheck', label: 'Attendance' } as MenuItem,
            { id: 'hr.devices', icon: 'Fingerprint', label: 'Biometric Devices' } as MenuItem,
          ]
        : []),
      { id: 'hr.leave', icon: 'CalendarOff', label: 'Leave' },
      { id: 'hr.holiday', icon: 'CalendarDays', label: 'Holiday' },
      { id: 'hr.expense', icon: 'Receipt', label: 'Expense Management' },
    ],
  },
  {
    id: 'hr.documents',
    label: 'Document & Evidence',
    icon: 'FileText',
    children: [
      { id: 'hr.broadcast', icon: 'Megaphone', label: 'Broadcast Centre' },
      { id: 'hr.doc_templates', icon: 'FileText', label: 'Document Templates' },
      { id: 'hr.custom_fields', icon: 'Star', label: 'Custom Fields' },
    ],
  },
];

export const SALES_GROUPS: MenuGroup[] = [
  {
    id: 'sales.insights',
    label: 'Sales Insights & Productivity',
    icon: 'BarChart3',
    children: [
      { id: 'sales.analytics', icon: 'BarChart3', label: 'Sales Analytics' },
      { id: 'sales.productivity_tracker', icon: 'ClipboardCheck', label: 'Productivity Tracker' },
    ],
  },
  {
    id: 'sales.core',
    label: 'Sales Core (Masters)',
    icon: 'Database',
    children: [
      { id: 'sales.customers', icon: 'UserSquare', label: 'Customers' },
      { id: 'sales.consignee', icon: 'Truck', label: 'Consignee' },
      { id: 'sales.lead_ack_master', icon: 'BadgeCheck', label: 'Lead Acknowledgement Master' },
    ],
  },
  {
    id: 'sales.operations',
    label: 'Sales Matrix Operations',
    icon: 'Activity',
    children: [
      { id: 'sales.workplace', icon: 'Activity', label: 'My Workplace' },
      { id: 'sales.quotation_vs_pi', icon: 'FileText', label: 'Quotation Vs PI History' },
    ],
  },
];

export const P2P_GROUPS: MenuGroup[] = [
  {
    id: 'p2p.intelligence',
    label: 'P2P Intelligence Hub',
    icon: 'LayoutGrid',
    children: [
      { id: 'p2p.analytics', icon: 'LayoutGrid', label: 'P2P Analytics' },
      { id: 'p2p.diagnosis', icon: 'ShieldCheck', label: 'P2P Diagnosis & Resolution Summary' },
      { id: 'p2p.sales_summary', icon: 'BarChart4', label: 'Sales Summary' },
    ],
  },
  {
    id: 'p2p.master',
    label: 'P2P Master Management',
    icon: 'Database',
    children: [
      { id: 'p2p.product', icon: 'Tag', label: 'Product Management' },
      { id: 'p2p.supplier', icon: 'UserPlus', label: 'Supplier Management' },
    ],
  },
  {
    id: 'p2p.procurement',
    label: 'Procurement Management',
    icon: 'Activity',
    children: [
      { id: 'p2p.bulk_sourcing', icon: 'Activity', label: 'Bulk Sourcing Management' },
      { id: 'p2p.case_to_case', icon: 'Activity', label: 'Case to Case Procurement Management' },
    ],
  },
  {
    id: 'p2p.purchase',
    label: 'Purchase Management',
    icon: 'FileText',
    children: [
      { id: 'p2p.order', icon: 'FileText', label: 'Purchase Order' },
      { id: 'p2p.invoice', icon: 'Receipt', label: 'Supplier Purchase Invoice (Temporary Putaway)' },
      { id: 'p2p.payment_request', icon: 'IndianRupee', label: 'Payment Request Management' },
      { id: 'p2p.advance_refund', icon: 'FileInput', label: 'Advance Receipt Refund Adjustment' },
    ],
  },
];

export const CLM_GROUPS: MenuGroup[] = [
  {
    id: 'clm.command',
    label: 'CLM Command Center',
    icon: 'LayoutDashboard',
    children: [
      { id: 'clm.analytics', icon: 'BarChart3', label: 'CLM Analytics' },
      { id: 'clm.diagnosis_resolution', icon: 'Stethoscope', label: 'Diagnosis & Resolution Center' },
      { id: 'clm.regulatory_defense', icon: 'ShieldCheck', label: 'Regulatory Defense File' },
    ],
  },
  {
    id: 'clm.ops_with',
    label: 'CLM Operations — With Shipment ID',
    icon: 'Truck',
    children: [
      { id: 'clm.buyer_profile', icon: 'User', label: 'Customer Profile' },
      { id: 'clm.supplier_profile', icon: 'Truck', label: 'Supplier Profile' },
    ],
  },
  {
    id: 'clm.ops_without',
    label: 'CLM Operations — Without Shipment ID',
    icon: 'FileText',
    children: [
      { id: 'clm.case_to_case', icon: 'FileText', label: 'Case to Case Contracts' },
      { id: 'clm.agreements_sent', icon: 'Send', label: 'Agreements We Sent' },
      { id: 'clm.agreements_to_approve', icon: 'CheckCircle', label: 'Agreements To Approve' },
    ],
  },
  {
    id: 'clm.compliance',
    label: 'Compliance & Regulatory',
    icon: 'ShieldCheck',
    children: [
      { id: 'clm.segment', icon: 'LayoutGrid', label: 'Segment' },
      { id: 'clm.authority', icon: 'Award', label: 'Authority' },
      { id: 'clm.quality_docs', icon: 'CheckSquare', label: 'Quality & Compliance Docs' },
      { id: 'clm.kyc', icon: 'UserCheck', label: 'KYC' },
      { id: 'clm.due_diligence', icon: 'Search', label: 'Due Diligence (DD)' },
      { id: 'clm.trade_licenses', icon: 'FileBadge', label: 'Trade Licenses' },
    ],
  },
  {
    id: 'clm.documents',
    label: 'Contract & Document Masters',
    icon: 'BookOpen',
    children: [
      { id: 'clm.document_panel', icon: 'PenSquare', label: 'Document Control Panel' },
      { id: 'clm.trade_documents', icon: 'Hexagon', label: 'Trade Documents' },
      { id: 'clm.agreements', icon: 'Users', label: 'Agreements' },
      { id: 'clm.terms_conditions', icon: 'List', label: 'Terms & Conditions' },
      { id: 'clm.clause_library', icon: 'BookOpen', label: 'Clause Library' },
    ],
  },
];

const ALL_TENANT_ROLES: UserRole[] = ['super_admin', 'client_admin', 'client_user', 'branch_user', 'employee'];

export const DEVELOPERS_GROUPS: MenuGroup[] = [
  {
    id: 'developers.ops',
    label: 'Operations',
    icon: 'Truck',
    children: [
      { id: 'developers.shipment', icon: 'Truck', label: 'Shipment' },
    ],
  },
];

export const MENU_ITEMS: MenuItem[] = [
  { id: 'dashboard', icon: 'LayoutGrid', label: 'Dashboard', roles: ALL_TENANT_ROLES },

  { id: '', section: 'MANAGEMENT', label: '', icon: '', roles: ['super_admin'] },
  { id: 'clients', icon: 'Building2', label: 'Clients', roles: ['super_admin'] },

  { id: '', section: 'BILLING', label: '', icon: '', roles: ['super_admin'] },
  { id: 'plans', icon: 'CreditCard', label: 'Plans', roles: ['super_admin'] },
  { id: 'payments', icon: 'IndianRupee', label: 'Payments', roles: ['super_admin'] },

  { id: '', section: 'OPERATIONS', label: '', icon: '', roles: ['client_admin'] },
  { id: 'branches', icon: 'GitBranch', label: 'Branches', roles: ['client_admin'] },

  { id: '', section: 'BILLING', label: '', icon: '', roles: ['client_admin'] },
  { id: 'my-plan', icon: 'CreditCard', label: 'My Plan', roles: ['client_admin'] },

  { id: 'credentials-vault', icon: 'KeyRound', label: 'Credentials Vault', roles: ALL_TENANT_ROLES },
  { id: 'project-navigator', icon: 'Compass', label: 'Project Navigator', roles: ALL_TENANT_ROLES },
  {
    id: 'hr',
    icon: 'Users',
    label: 'HRMS',
    roles: ['branch_user', 'employee'],
    groups: HR_GROUPS,
  },
  {
    id: 'sales',
    icon: 'TrendingUp',
    label: 'Sales Matrix',
    roles: ['branch_user', 'employee'],
    groups: SALES_GROUPS,
  },
  {
    id: 'clm',
    icon: 'FileText',
    label: 'CLM',
    roles: ['branch_user', 'employee'],
    groups: CLM_GROUPS,
  },
  { id: 'p2p', icon: 'ShoppingBag', label: 'Procure to Pay (P2P)', roles: ALL_TENANT_ROLES },
  {
    id: 'developers',
    icon: 'Truck',
    label: 'Shipment 360',
    roles: ALL_TENANT_ROLES,
    groups: DEVELOPERS_GROUPS,
  },
  { id: 'gts', icon: 'Globe', label: 'GTS (E-Docs)', roles: ALL_TENANT_ROLES },
  { id: 'inventory', icon: 'Boxes', label: 'Inventory Management System', roles: ALL_TENANT_ROLES },
  {
    id: 'master',
    icon: 'Database',
    label: 'Master',
    roles: ALL_TENANT_ROLES,
    groups: MASTER_GROUPS,
  },

  { id: 'clock-in', icon: 'CalendarCheck', label: 'Clock-In', roles: ['employee'] },

  { id: 'permissions', icon: 'ShieldCheck', label: 'Permissions', roles: ['super_admin', 'client_admin', 'branch_user', 'employee'] },

  { id: 'settings', icon: 'Settings', label: 'Settings', roles: ['super_admin'] },
  { id: 'profile', icon: 'UserCircle', label: 'Profile', roles: ALL_TENANT_ROLES },
];
