import type { MenuItem, MenuGroup } from './types';

export const MASTER_GROUPS: MenuGroup[] = [
  {
    id: 'master.identity',
    label: 'Identity & Entity',
    icon: 'IdCard',
    children: [
      { id: 'master.company',        icon: 'Building',    label: 'Company Details' },
      { id: 'master.bank_accounts',  icon: 'Landmark',    label: 'Bank Accounts' },
      { id: 'master.departments',    icon: 'Building2',   label: 'Departments' },
      { id: 'master.roles',          icon: 'UserCog',     label: 'Roles' },
      { id: 'master.designations',   icon: 'BadgeCheck',  label: 'Designations' },
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
      { id: 'master.vendor_types',             icon: 'Store',      label: 'Vendor Types' },
      { id: 'master.vendor_behaviour',         icon: 'Activity',   label: 'Vendor Behaviour' },
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
      { id: 'master.assets',           icon: 'Briefcase', label: 'Assets' },
      { id: 'master.asset_categories', icon: 'Tags',      label: 'Asset Categories' },
      { id: 'master.numbering_series', icon: 'Hash',      label: 'Numbering Series' },
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
      { id: 'master.vendor_directory',       icon: 'BookUser',     label: 'Vendor Directory' },
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
];

export const MENU_ITEMS: MenuItem[] = [
  { id: '', section: 'MAIN', label: '', icon: '', roles: ['super_admin', 'client_admin', 'branch_user'] },
  { id: 'dashboard', icon: 'LayoutGrid', label: 'Dashboard', roles: ['super_admin', 'client_admin', 'branch_user'] },

  { id: '', section: 'MANAGEMENT', label: '', icon: '', roles: ['super_admin'] },
  { id: 'clients', icon: 'Building2', label: 'Clients', roles: ['super_admin'] },

  { id: '', section: 'BILLING', label: '', icon: '', roles: ['super_admin'] },
  { id: 'plans', icon: 'CreditCard', label: 'Plans', roles: ['super_admin'] },
  { id: 'payments', icon: 'IndianRupee', label: 'Payments', roles: ['super_admin'] },

  { id: '', section: 'OPERATIONS', label: '', icon: '', roles: ['client_admin', 'branch_user'] },
  { id: 'branches', icon: 'GitBranch', label: 'Branches', roles: ['client_admin'] },
  { id: 'employees', icon: 'UserCheck', label: 'Employees', roles: ['client_admin', 'branch_user'] },

  { id: '', section: 'BILLING', label: '', icon: '', roles: ['client_admin'] },
  { id: 'my-plan', icon: 'CreditCard', label: 'My Plan', roles: ['client_admin'] },

  { id: '', section: 'MASTER DATA', label: '', icon: '', roles: ['super_admin', 'client_admin', 'branch_user'] },
  {
    id: 'master',
    icon: 'Database',
    label: 'Master',
    roles: ['super_admin', 'client_admin', 'branch_user'],
    groups: MASTER_GROUPS,
  },

  { id: '', section: 'ACCESS CONTROL', label: '', icon: '', roles: ['super_admin', 'client_admin'] },
  { id: 'permissions', icon: 'ShieldCheck', label: 'Permissions', roles: ['super_admin', 'client_admin'] },

  { id: '', section: 'SYSTEM', label: '', icon: '', roles: ['super_admin', 'client_admin', 'branch_user'] },
  { id: 'settings', icon: 'Settings', label: 'Settings', roles: ['super_admin'] },
  { id: 'profile', icon: 'UserCircle', label: 'Profile', roles: ['super_admin', 'client_admin', 'branch_user'] },
];
