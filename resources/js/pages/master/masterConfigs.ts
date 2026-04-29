// Generic master config — one entry per master.
// Every master shares the same page shell; only fields/columns/seed/wtd differ.

export type FieldOption = string | { value: string; label: string };

export type FieldDef = {
  n: string;                // field name (row key)
  l: string;                // label
  t: 'text' | 'number' | 'email' | 'date' | 'textarea' | 'select';
  r?: boolean;              // required
  p?: string;               // placeholder
  full?: boolean;           // span full row
  opts?: FieldOption[];     // select options — string or { value, label } for distinct display/payload
  ref?: string;             // ref to another master key (dropdown from that master's data)
  refL?: string;            // label field on the referenced master
  refLFmt?: string;         // composite label template, e.g. "{name} ({level})" — overrides refL
  sec?: string;             // section divider (no input, header only)
  auto?: boolean;           // server-generated value (e.g. auto-numbered code); rendered read-only
  hint?: string;            // small italic helper text shown next to the label
  autogen?: (rows: any[]) => string; // optional client-side preview of an auto-generated value
  noneLabel?: string;       // explicit "none/empty" option label for ref dropdowns (e.g. "— None (Top Level) —")
};

export type WtdStep = { icon: string; title: string; desc: string };

// Optional KPI strip rendered above the search bar on a master page.
// `compute` receives the full record array and returns the KPI value.
export type KpiDef = {
  label: string;
  icon: string;        // remix icon class
  gradient: string;    // CSS linear-gradient for the icon tile + top accent stripe
  compute: (records: any[]) => number;
};

export type MasterConfig = {
  key: string;
  slug: string;
  title: string;
  titleSingular?: string;   // used in modal title e.g. "Add Company Detail"
  icon: string;             // remix icon class like "ri-building-4-line"
  iconColor: string;        // "primary" | "success" | etc. (Bootstrap)
  iconBg: string;           // used with ${color}-subtle bg
  desc: string;
  cat: string;
  endpoint?: string;        // custom REST endpoint prefix (default: `/master/${slug}`)
  fields: FieldDef[];
  cols: string[];
  colL: string[];
  uFields?: string[];
  data: any[];
  wtd: WtdStep[];
  kpis?: KpiDef[];
};

/** Turn opts (string | {value,label}) into uniform {value,label} pairs for rendering. */
export function normalizeOpts(opts: FieldOption[] | undefined): { value: string; label: string }[] {
  return (opts || []).map(o => typeof o === 'string' ? { value: o, label: o } : o);
}

/** Endpoint for a master — honors the optional override. */
export function masterEndpoint(cfg: Pick<MasterConfig, 'slug' | 'endpoint'>): string {
  return cfg.endpoint || `/master/${cfg.slug}`;
}

const C: Record<string, MasterConfig> = {
  // ---------- IDENTITY & ENTITY ----------
  company: {
    key: 'company', slug: 'company', title: 'Company Details', titleSingular: 'Company Detail',
    icon: 'ri-building-4-line', iconColor: 'primary', iconBg: 'primary',
    desc: 'Legal identity, GSTIN, PAN, IEC — used on every export document',
    cat: 'Identity & Entity',
    fields: [
      { n: 'company_name', l: 'Company Name', t: 'text', r: true, p: 'e.g. Inorbvict Healthcare India Pvt Ltd', full: true },
      { n: 'short_code', l: 'Short Code', t: 'text', r: true, p: 'e.g. IGC' },
      { n: 'gstin', l: 'GSTIN', t: 'text', r: true, p: '27AADCI6120M1ZH' },
      { n: 'pan', l: 'PAN Number', t: 'text', r: true, p: 'AADCI6120M' },
      { n: 'cin', l: 'CIN', t: 'text', p: 'U85100PN2014PTC152252' },
      { n: 'iec', l: 'IEC Code', t: 'text', p: '3114017398' },
      { n: 'email', l: 'Email', t: 'email', p: 'info@company.com' },
      { n: 'mobile', l: 'Mobile', t: 'text', p: '+91 98500 00000' },
      { n: 'city', l: 'City', t: 'text', p: 'Pune' },
      { n: 'state', l: 'State', t: 'text', p: 'Maharashtra' },
      { n: 'address', l: 'Registered Address', t: 'textarea', p: 'Full address', full: true },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['company_name', 'short_code', 'gstin', 'city', 'status'],
    colL: ['Company Name', 'Short Code', 'GSTIN', 'City', 'Status'],
    uFields: ['company_name', 'gstin', 'pan'],
    data: [{ id: 1, company_name: 'Inorbvict Healthcare India Pvt Ltd', short_code: 'IGC', gstin: '27AADCI6120M1ZH', pan: 'AADCI6120M', cin: 'U85100PN2014PTC152252', iec: '3114017398', email: 'info@inhpl.com', mobile: '+91 98500 00000', city: 'Pune', state: 'Maharashtra', address: 'Solitaire Hub, Outer Ring Road, Balewadi, Pune - 411045', status: 'Active' }],
    wtd: [
      { icon: 'ri-building-4-line', title: 'Set Company Identity', desc: 'Legal name, short code' },
      { icon: 'ri-file-list-3-line', title: 'Add Tax Info', desc: 'GSTIN, PAN, CIN, IEC for exports' },
      { icon: 'ri-global-line', title: 'Add Contact Details', desc: 'Email, mobile, website, address' },
      { icon: 'ri-checkbox-circle-line', title: 'Set Status Active', desc: 'Enables use across all modules' },
    ],
  },

  organization_types: {
    key: 'organization_types', slug: 'organization_types', title: 'Organization Types', titleSingular: 'Organization Type',
    icon: 'ri-building-line', iconColor: 'primary', iconBg: 'primary',
    desc: 'Industry categories used in the client registration dropdown',
    cat: 'Identity & Entity',
    endpoint: '/organization-types',
    fields: [
      { n: 'name', l: 'Name', t: 'text', r: true, p: 'e.g. Manufacturing, Logistics', full: true },
      { n: 'icon', l: 'Icon (Remix Icon class)', t: 'text', p: 'ri-building-line' },
      { n: 'sort_order', l: 'Sort Order', t: 'number', p: 'auto' },
      { n: 'description', l: 'Description', t: 'textarea', p: 'Short description shown in admin lists', full: true },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
    ],
    cols: ['name', 'description', 'sort_order', 'status'],
    colL: ['Name', 'Description', 'Order', 'Status'],
    uFields: ['name'],
    data: [],
    wtd: [
      { icon: 'ri-building-line',        title: 'Define Organization Types', desc: 'Create industry categories for client onboarding' },
      { icon: 'ri-image-line',           title: 'Assign Icon',               desc: 'Pick a Remix Icon to visualize each type' },
      { icon: 'ri-file-text-line',       title: 'Add Description',           desc: 'Short hint shown in admin lists' },
      { icon: 'ri-checkbox-circle-line', title: 'Set Status Active',         desc: 'Enables the type in client registration' },
    ],
  },

  bank_accounts: {
    key: 'bank_accounts', slug: 'bank_accounts', title: 'Bank Accounts', titleSingular: 'Bank Account',
    icon: 'ri-bank-line', iconColor: 'info', iconBg: 'info',
    desc: 'Bank registry — Swift Code + AD Code mandatory for export',
    cat: 'Identity & Entity',
    fields: [
      { n: 'bank_name', l: 'Bank Name', t: 'text', r: true, p: 'State Bank of India' },
      { n: 'account_holder', l: 'Account Holder', t: 'text', r: true, p: 'As per bank records' },
      { n: 'account_number', l: 'Account Number', t: 'text', r: true, p: 'Full account number' },
      { n: 'ifsc_code', l: 'IFSC Code', t: 'text', r: true, p: 'SBIN0000691' },
      { n: 'branch_name', l: 'Branch Name', t: 'text', p: 'Branch name' },
      { n: 'city', l: 'City', t: 'text', p: 'City' },
      { sec: 'Export Banking', n: '', l: '', t: 'text' },
      { n: 'swift_code', l: 'Swift Code', t: 'text', r: true, p: 'SBININBB104' },
      { n: 'ad_code', l: 'AD Code', t: 'text', r: true, p: 'Authorized Dealer code' },
      { n: 'is_primary', l: 'Primary Account', t: 'select', opts: ['No', 'Yes'] },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['bank_name', 'account_holder', 'account_number', 'ifsc_code', 'swift_code', 'status'],
    colL: ['Bank Name', 'Account Holder', 'Account No.', 'IFSC', 'Swift Code', 'Status'],
    uFields: ['account_number', 'ifsc_code'],
    data: [{ id: 1, bank_name: 'State Bank of India', account_holder: 'Inorbvict Healthcare Pvt Ltd', account_number: '••••1122', ifsc_code: 'SBIN0000691', branch_name: 'New Delhi Main Branch', city: 'New Delhi', swift_code: 'SBININBB104', ad_code: '0510573', is_primary: 'Yes', status: 'Active' }],
    wtd: [
      { icon: 'ri-bank-line', title: 'Add Bank Details', desc: 'Account number, IFSC, branch' },
      { icon: 'ri-global-line', title: 'Export Fields', desc: 'Swift Code + AD Code for FIRC/eBRC' },
      { icon: 'ri-star-line', title: 'Mark Primary Account', desc: 'Used on all export documents' },
      { icon: 'ri-checkbox-circle-line', title: 'Set Status Active', desc: 'Account ready for use' },
    ],
  },

  departments: {
    key: 'departments', slug: 'departments', title: 'Department Master', titleSingular: 'Department',
    icon: 'ri-building-line', iconColor: 'primary', iconBg: 'primary',
    desc: 'Manage all departments, structure, ownership, and readiness for HR operations',
    cat: 'Identity & Entity',
    fields: [
      { n: 'name', l: 'Department Name', t: 'text', r: true, p: 'e.g. Software Development' },
      { n: 'code', l: 'Department Code', t: 'text', r: true, p: 'e.g. DEPT-001',
        autogen: (records: any[]) => {
          const max = records.reduce((m: number, r: any) => {
            const match = /^DEPT-(\d+)$/i.exec(String(r.code || '').trim());
            const n = match ? parseInt(match[1], 10) : 0;
            return n > m ? n : m;
          }, 0);
          return `DEPT-${String(max + 1).padStart(3, '0')}`;
        } },
      // Self-reference: parent_id points to another department row (refL = 'name').
      // noneLabel prepends a "Root Department" entry so a department can be set as top-level.
      { n: 'parent_id', l: 'Parent Department', t: 'select', ref: 'departments', refL: 'name',
        noneLabel: '— None (Root Department) —' },
      // Display "Name — Designation" in the dropdown but persist only the name as the value.
      { n: 'head', l: 'Department Head', t: 'select', noneLabel: '— Select Employee —', opts: [
        { value: 'Gaurav Jagtap',   label: 'Gaurav Jagtap — Software Developer' },
        { value: 'Atharv Patekar',  label: 'Atharv Patekar — QA Engineer' },
        { value: 'Parth Lakare',    label: 'Parth Lakare — Business Analyst' },
        { value: 'Sonal Pawar',     label: 'Sonal Pawar — HR Executive' },
        { value: 'Nisha Kapoor',    label: 'Nisha Kapoor — Finance Manager' },
        { value: 'Kiran Patel',     label: 'Kiran Patel — Sales Lead' },
        { value: 'Manoj Gawade',    label: 'Manoj Gawade — Logistics Manager' },
        { value: 'Durgesh Urkude',  label: 'Durgesh Urkude — Sales Manager' },
        { value: 'Ankit Bhosale',   label: 'Ankit Bhosale — Purchase Manager' },
        { value: 'Priti Shende',    label: 'Priti Shende — Accounts Manager' },
        { value: 'Sandeep Kadu',    label: 'Sandeep Kadu — Logistics Manager' },
        { value: 'Rohit Nagpure',   label: 'Rohit Nagpure — Sales Executive' },
      ] },
      { n: 'email', l: 'Department Email', t: 'email', p: 'e.g. sd@enterprise.com' },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['code', 'name', 'parent_id', 'head', 'status'],
    colL: ['Code', 'Department Name', 'Parent Dept', 'Head', 'Status'],
    uFields: ['code'],
    data: [],
    wtd: [
      { icon: 'ri-building-line', title: 'Name Your Department', desc: 'e.g. Sales, HR, Accounts' },
      { icon: 'ri-hashtag', title: 'Assign Code', desc: 'Unique code like DEPT-001' },
      { icon: 'ri-user-star-line', title: 'Pick a Head', desc: 'The person owning the department' },
      { icon: 'ri-checkbox-circle-line', title: 'Set Status Active', desc: 'Department available for assignment' },
    ],
    kpis: [
      { label: 'Total Depts', icon: 'ri-building-line',
        gradient: 'linear-gradient(135deg,#7c5cfc,#a993fd)',
        compute: rs => rs.length },
      { label: 'Active', icon: 'ri-checkbox-circle-line',
        gradient: 'linear-gradient(135deg,#0ab39c,#02c8a7)',
        compute: rs => rs.filter(r => String(r.status).toLowerCase() === 'active').length },
      { label: 'Head Assigned', icon: 'ri-user-star-line',
        gradient: 'linear-gradient(135deg,#405189,#6691e7)',
        compute: rs => rs.filter(r => r.head && String(r.head).trim() !== '').length },
      { label: 'No Head', icon: 'ri-user-unfollow-line',
        gradient: 'linear-gradient(135deg,#f06548,#f4907b)',
        compute: rs => rs.filter(r => !r.head || String(r.head).trim() === '').length },
      { label: 'Missing Config', icon: 'ri-error-warning-line',
        gradient: 'linear-gradient(135deg,#f7b84b,#fcd07a)',
        compute: rs => rs.filter(r => !r.email || String(r.email).trim() === '').length },
      { label: 'Inactive', icon: 'ri-forbid-line',
        gradient: 'linear-gradient(135deg,#878a99,#b9bcc6)',
        compute: rs => rs.filter(r => String(r.status).toLowerCase() === 'inactive').length },
    ],
  },

  roles: {
    key: 'roles', slug: 'roles', title: 'Roles', titleSingular: 'Role',
    icon: 'ri-user-settings-line', iconColor: 'danger', iconBg: 'danger',
    desc: 'User roles controlling module access permissions',
    cat: 'Identity & Entity',
    fields: [
      { n: 'name', l: 'Role Name', t: 'text', r: true, p: 'e.g., Software Engineer' },
      { n: 'code', l: 'Role Code', t: 'text', auto: true, hint: '(auto-generated)', p: 'ROL-XXX' },
      { n: 'role_type', l: 'Role Type', t: 'select', r: true, p: '— Select Type —', opts: ['Primary', 'Ancillary'] },
      { n: 'department_id', l: 'Department', t: 'select', ref: 'departments', refL: 'name', p: '— All Departments —' },
      { n: 'role_category', l: 'Role Category', t: 'select', p: '— Select Category —', opts: ['Technical', 'Management', 'Operational', 'Support', 'Sales', 'Compliance', 'Finance', 'HR'] },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
      { n: 'description', l: 'Description', t: 'textarea', p: "Brief description of this role's responsibilities and scope...", full: true },
    ],
    cols: ['code', 'name', 'role_type', 'department_id', 'role_category', 'status'],
    colL: ['Code', 'Role Name', 'Role Type', 'Department', 'Category', 'Status'],
    uFields: ['name'],
    data: [
      { id: 1, name: 'Admin',         code: 'ROL-01', role_type: 'Administrative', role_category: 'Management',  status: 'Active' },
      { id: 2, name: 'HR',            code: 'ROL-02', role_type: 'Functional',     role_category: 'HR',          status: 'Active' },
      { id: 3, name: 'Viewer',        code: 'ROL-03', role_type: 'Ancillary',      role_category: 'Support',     status: 'Active' },
      { id: 4, name: 'Approver',      code: 'ROL-04', role_type: 'Operational',    role_category: 'Compliance',  status: 'Active' },
      { id: 5, name: 'Accountant',    code: 'ROL-05', role_type: 'Functional',     role_category: 'Finance',     status: 'Active' },
      { id: 6, name: 'Auditor',       code: 'ROL-06', role_type: 'Functional',     role_category: 'Compliance',  status: 'Active' },
      { id: 7, name: 'Operator',      code: 'ROL-07', role_type: 'Operational',    role_category: 'Operational', status: 'Active' },
      { id: 8, name: 'Director',      code: 'ROL-08', role_type: 'Primary',        role_category: 'Management',  status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-team-line', title: 'Define Role Name', desc: 'e.g. Admin, Manager, Viewer' },
      { icon: 'ri-shield-keyhole-line', title: 'Controls Module Access', desc: 'Role decides what user can see' },
      { icon: 'ri-checkbox-circle-line', title: 'Set Status Active', desc: 'Role available for assignment' },
    ],
  },

  designations: {
    key: 'designations', slug: 'designations', title: 'Designations', titleSingular: 'Designation',
    icon: 'ri-verified-badge-line', iconColor: 'warning', iconBg: 'warning',
    desc: 'Job titles shown on letters, profiles & HR records',
    cat: 'Identity & Entity',
    fields: [
      { n: 'name', l: 'Designation Name', t: 'text', r: true, p: 'e.g., Senior Software Engineer' },
      { n: 'code', l: 'Designation Code', t: 'text', auto: true, hint: '(auto-generated)', p: 'DGN-XXX' },
      { n: 'department_id', l: 'Department', t: 'select', ref: 'departments', refL: 'name', p: '— All Departments —' },
      { n: 'level', l: 'Designation Level', t: 'select', r: true, p: '— Select Designation Level —', opts: ['Director / CEO', 'Head of Department (HOD)', 'Team Leader', 'Executive', 'Employee', 'Intern / Trainee'] },
      { n: 'reports_to_id', l: 'Reports To', t: 'select', ref: 'designations', refL: 'name', refLFmt: '{name} ({level})', p: '— None (Top Level) —' },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['code', 'name', 'department_id', 'level', 'reports_to_id', 'status'],
    colL: ['Code', 'Designation Name', 'Department', 'Designation Level', 'Reports To', 'Status'],
    uFields: ['name', 'code'],
    // Seed list — used as the Reports-To fallback when no records exist yet,
    // and as starter data so the dropdown is never empty during onboarding.
    data: [
      { id: 1,  name: 'CEO',                       code: 'DGN-001', level: 'Director / CEO',           status: 'Active' },
      { id: 2,  name: 'VP Engineering',            code: 'DGN-002', level: 'Director / CEO',           status: 'Active' },
      { id: 3,  name: 'IT Department Head',        code: 'DGN-003', level: 'Head of Department (HOD)', status: 'Active' },
      { id: 4,  name: 'HR Manager',                code: 'DGN-004', level: 'Head of Department (HOD)', status: 'Active' },
      { id: 5,  name: 'Finance Head',              code: 'DGN-005', level: 'Head of Department (HOD)', status: 'Active' },
      { id: 6,  name: 'QA Testing Lead',           code: 'DGN-006', level: 'Team Leader',              status: 'Active' },
      { id: 7,  name: 'Business Analyst Lead',     code: 'DGN-007', level: 'Team Leader',              status: 'Active' },
      { id: 8,  name: 'Senior Software Engineer',  code: 'DGN-008', level: 'Executive',                status: 'Active' },
      { id: 9,  name: 'Senior QA Engineer',        code: 'DGN-009', level: 'Executive',                status: 'Active' },
      { id: 10, name: 'Sr. Business Analyst',      code: 'DGN-010', level: 'Executive',                status: 'Active' },
      { id: 11, name: 'HR Executive',              code: 'DGN-011', level: 'Executive',                status: 'Active' },
      { id: 12, name: 'Finance Analyst',           code: 'DGN-012', level: 'Executive',                status: 'Active' },
      { id: 13, name: 'Software Engineer',         code: 'DGN-013', level: 'Employee',                 status: 'Active' },
      { id: 14, name: 'QA Engineer',               code: 'DGN-014', level: 'Employee',                 status: 'Active' },
      { id: 15, name: 'Business Analyst',          code: 'DGN-015', level: 'Employee',                 status: 'Active' },
      { id: 16, name: 'HR Associate',              code: 'DGN-016', level: 'Employee',                 status: 'Active' },
      { id: 17, name: 'Finance Associate',         code: 'DGN-017', level: 'Employee',                 status: 'Active' },
      { id: 18, name: 'Software Intern',           code: 'DGN-018', level: 'Intern / Trainee',         status: 'Active' },
      { id: 19, name: 'HR Intern',                 code: 'DGN-019', level: 'Intern / Trainee',         status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-briefcase-4-line', title: 'Add Designation Title', desc: 'e.g. Operations Manager' },
      { icon: 'ri-stack-line', title: 'Pick Level & Reporting', desc: 'Hierarchy + manager link' },
      { icon: 'ri-checkbox-circle-line', title: 'Set Status Active', desc: 'Designation available for staff' },
    ],
  },

  kpis: {
    key: 'kpis', slug: 'kpis', title: 'KPI Master', titleSingular: 'KPI',
    icon: 'ri-bar-chart-2-line', iconColor: 'info', iconBg: 'info',
    desc: 'Define performance targets, role assignments & tracking criteria',
    cat: 'Identity & Entity',
    fields: [
      { n: 'name', l: 'KPI Name', t: 'text', r: true, p: 'e.g. Monthly Sales Target, Revenue Growth, Task Completion Rate…' },
      { n: 'role_id', l: 'Role', t: 'select', r: true, ref: 'roles', refL: 'name', p: '— Select from Role Master —' },
      { n: 'target_type', l: 'Target Type', t: 'select', r: true, p: 'Please Select KPI target', opts: ['Numeric', 'Percentage', 'Currency', 'Boolean', 'Date-based', 'Rating'] },
      { n: 'priority', l: 'Priority', t: 'select', r: true, p: 'Select priority…', opts: ['Critical', 'High', 'Medium', 'Low'] },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
      { n: 'description', l: 'Description', t: 'textarea', p: 'Describe what this KPI measures, its tracking method, and expected outcomes…', full: true },
    ],
    cols: ['name', 'role_id', 'target_type', 'priority', 'status'],
    colL: ['KPI Name', 'Role', 'Target Type', 'Priority', 'Status'],
    uFields: ['name'],
    data: [
      { id: 1, name: 'Monthly Sales Target',  target_type: 'Currency',   priority: 'High',     status: 'Active' },
      { id: 2, name: 'Revenue Growth',        target_type: 'Percentage', priority: 'Critical', status: 'Active' },
      { id: 3, name: 'Task Completion Rate',  target_type: 'Percentage', priority: 'Medium',   status: 'Active' },
      { id: 4, name: 'Customer Satisfaction', target_type: 'Rating',     priority: 'High',     status: 'Active' },
      { id: 5, name: 'On-time Delivery',      target_type: 'Boolean',    priority: 'Medium',   status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-bar-chart-2-line', title: 'Define KPI Target', desc: 'Numeric / Percentage / Currency / etc.' },
      { icon: 'ri-team-line', title: 'Assign To Role', desc: 'Map the KPI to a Role from Role Master' },
      { icon: 'ri-flag-line', title: 'Set Priority', desc: 'Critical / High / Medium / Low' },
      { icon: 'ri-checkbox-circle-line', title: 'Activate Tracking', desc: 'Set status Active to start tracking' },
    ],
  },

  // ---------- GEOGRAPHY & LOCATION ----------
  countries: {
    key: 'countries', slug: 'countries', title: 'Countries', titleSingular: 'Country',
    icon: 'ri-earth-line', iconColor: 'info', iconBg: 'info',
    desc: 'Country master — referenced on all trade documents',
    cat: 'Geography & Location',
    fields: [
      { n: 'name', l: 'Country Name', t: 'text', r: true, p: 'e.g. India' },
      { n: 'iso_code', l: 'ISO Code', t: 'text', p: 'e.g. IN' },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['name', 'iso_code', 'status'],
    colL: ['Country Name', 'ISO Code', 'Status'],
    uFields: ['name'],
    data: [
      { id: 1, name: 'India', iso_code: 'IN', status: 'Active' },
      { id: 2, name: 'United States', iso_code: 'US', status: 'Active' },
      { id: 3, name: 'United Kingdom', iso_code: 'GB', status: 'Active' },
      { id: 4, name: 'Germany', iso_code: 'DE', status: 'Active' },
      { id: 5, name: 'China', iso_code: 'CN', status: 'Active' },
      { id: 6, name: 'Japan', iso_code: 'JP', status: 'Active' },
      { id: 7, name: 'UAE', iso_code: 'AE', status: 'Active' },
      { id: 8, name: 'Australia', iso_code: 'AU', status: 'Active' },
      { id: 9, name: 'Canada', iso_code: 'CA', status: 'Active' },
      { id: 10, name: 'Brazil', iso_code: 'BR', status: 'Active' },
      { id: 11, name: 'France', iso_code: 'FR', status: 'Active' },
      { id: 12, name: 'South Africa', iso_code: 'ZA', status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-global-line', title: 'Add Country Name', desc: 'e.g. India, UAE, Germany' },
      { icon: 'ri-hashtag', title: 'Add ISO Code', desc: '2-letter — IN, AE, DE' },
      { icon: 'ri-ship-line', title: 'Used On Trade Docs', desc: 'Invoices, shipping, ports' },
      { icon: 'ri-checkbox-circle-line', title: 'Set Status Active', desc: 'Available for address & ports' },
    ],
  },

  states: {
    key: 'states', slug: 'states', title: 'States', titleSingular: 'State',
    icon: 'ri-map-2-line', iconColor: 'success', iconBg: 'success',
    desc: 'State list for addresses & GST place-of-supply',
    cat: 'Geography & Location',
    fields: [
      { n: 'country_id', l: 'Country', t: 'select', r: true, ref: 'countries', refL: 'name' },
      { n: 'name', l: 'State Name', t: 'text', r: true, p: 'e.g. Maharashtra' },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['name', 'country_id', 'status'],
    colL: ['State Name', 'Country', 'Status'],
    uFields: ['name', 'country_id'],
    data: [
      { id: 1, country_id: 1, name: 'Maharashtra', status: 'Active' },
      { id: 2, country_id: 1, name: 'Gujarat', status: 'Active' },
      { id: 3, country_id: 1, name: 'Delhi', status: 'Active' },
      { id: 4, country_id: 1, name: 'Karnataka', status: 'Active' },
      { id: 5, country_id: 1, name: 'Tamil Nadu', status: 'Active' },
      { id: 6, country_id: 2, name: 'California', status: 'Active' },
      { id: 7, country_id: 2, name: 'New York', status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-global-line', title: 'Select Parent Country', desc: 'Country required first' },
      { icon: 'ri-map-2-line', title: 'Add State Name', desc: 'e.g. Maharashtra, Gujarat' },
      { icon: 'ri-money-rupee-circle-line', title: 'GST Place-of-Supply', desc: 'State drives IGST vs CGST/SGST' },
      { icon: 'ri-checkbox-circle-line', title: 'Set Status Active', desc: 'Available for addresses' },
    ],
  },

  state_codes: {
    key: 'state_codes', slug: 'state_codes', title: 'State Codes', titleSingular: 'State Code',
    icon: 'ri-hashtag', iconColor: 'primary', iconBg: 'primary',
    desc: '2-digit GST state codes for tax filings',
    cat: 'Geography & Location',
    fields: [
      { n: 'state_id', l: 'State', t: 'select', r: true, ref: 'states', refL: 'name' },
      { n: 'state_code', l: 'State Code', t: 'text', r: true, p: 'e.g. 27 for Maharashtra' },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['state_id', 'state_code', 'status'],
    colL: ['State', 'State Code', 'Status'],
    uFields: ['state_id', 'state_code'],
    data: [
      { id: 1, state_id: 1, state_code: '27', status: 'Active' },
      { id: 2, state_id: 2, state_code: '24', status: 'Active' },
      { id: 3, state_id: 3, state_code: '07', status: 'Active' },
      { id: 4, state_id: 4, state_code: '29', status: 'Active' },
      { id: 5, state_id: 5, state_code: '33', status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-map-2-line', title: 'Select State', desc: 'Link the 2-digit code to a state' },
      { icon: 'ri-hashtag', title: 'Enter GST State Code', desc: 'e.g. 27 Maharashtra, 24 Gujarat' },
      { icon: 'ri-file-list-3-line', title: 'Printed On GST Invoices', desc: 'Mandatory for GST compliance' },
      { icon: 'ri-checkbox-circle-line', title: 'Set Status Active', desc: 'Code used in invoice generation' },
    ],
  },

  address_types: {
    key: 'address_types', slug: 'address_types', title: 'Address Types', titleSingular: 'Address Type',
    icon: 'ri-home-line', iconColor: 'warning', iconBg: 'warning',
    desc: 'Tag addresses: Billing, Shipping, Registered, etc.',
    cat: 'Geography & Location',
    fields: [
      { n: 'name', l: 'Address Type', t: 'text', r: true, p: 'e.g. Registered Office, Warehouse' },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['name', 'status'],
    colL: ['Address Type', 'Status'],
    uFields: ['name'],
    data: [
      { id: 1, name: 'Registered Office Address', status: 'Active' },
      { id: 2, name: 'Warehouse', status: 'Active' },
      { id: 3, name: 'Branch Address', status: 'Active' },
      { id: 4, name: 'Billing Address', status: 'Active' },
      { id: 5, name: 'Shipping Address', status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-home-line', title: 'Define Address Label', desc: 'e.g. Registered Office, Warehouse' },
      { icon: 'ri-price-tag-3-line', title: 'Tags Any Address', desc: 'Classifies customer & vendor addresses' },
      { icon: 'ri-checkbox-circle-line', title: 'Set Status Active', desc: 'Available for address tagging' },
    ],
  },

  port_of_loading: {
    key: 'port_of_loading', slug: 'port_of_loading', title: 'Ports of Loading', titleSingular: 'Port of Loading',
    icon: 'ri-anchor-line', iconColor: 'info', iconBg: 'info',
    desc: 'Origin ports on shipping bills & export invoices',
    cat: 'Geography & Location',
    fields: [
      { n: 'name', l: 'Port Name', t: 'text', r: true, p: 'e.g. Chennai Port' },
      { n: 'code', l: 'Port Code', t: 'text', r: true, p: 'e.g. INMAA' },
      { n: 'address', l: 'Address', t: 'textarea', p: 'Port address', full: true },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['name', 'code', 'status'],
    colL: ['Port Name', 'Port Code', 'Status'],
    uFields: ['code'],
    data: [
      { id: 1, name: 'Chennai Port', code: 'INMAA', address: 'Chennai Port Trust, Chennai - 600001', status: 'Active' },
      { id: 2, name: 'Jawaharlal Nehru Port', code: 'INNSA', address: 'JNPT, Nhava Sheva, Mumbai', status: 'Active' },
      { id: 3, name: 'Mundra Port', code: 'INMUN', address: 'Mundra, Kutch, Gujarat', status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-anchor-line', title: 'Add Port Name & Code', desc: 'e.g. Chennai Port — INMAA' },
      { icon: 'ri-ship-line', title: 'Used On Shipping Bills', desc: 'Origin port on export documents' },
      { icon: 'ri-checkbox-circle-line', title: 'Set Status Active', desc: 'Available for shipment creation' },
    ],
  },

  port_of_discharge: {
    key: 'port_of_discharge', slug: 'port_of_discharge', title: 'Ports of Discharge', titleSingular: 'Port of Discharge',
    icon: 'ri-ship-line', iconColor: 'primary', iconBg: 'primary',
    desc: 'Destination ports on packing lists & shipping docs',
    cat: 'Geography & Location',
    fields: [
      { n: 'name', l: 'Port Name', t: 'text', r: true, p: 'e.g. Port Jebel Ali' },
      { n: 'code', l: 'Port Code', t: 'text', r: true, p: 'e.g. AEJEA' },
      { n: 'country_id', l: 'Country', t: 'select', r: true, ref: 'countries', refL: 'name' },
      { n: 'city', l: 'City', t: 'text', p: 'Port city' },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['name', 'code', 'country_id', 'city', 'status'],
    colL: ['Port Name', 'Code', 'Country', 'City', 'Status'],
    uFields: ['code'],
    data: [{ id: 1, name: 'Port Jebel Ali', code: 'AEJEA', country_id: 7, city: 'Dubai', status: 'Active' }],
    wtd: [
      { icon: 'ri-ship-line', title: 'Add Destination Port', desc: 'e.g. Port Jebel Ali — AEJEA' },
      { icon: 'ri-global-line', title: 'Link to Country', desc: 'Port belongs to destination country' },
      { icon: 'ri-file-list-3-line', title: 'On Packing Lists', desc: 'Discharge port printed on export docs' },
      { icon: 'ri-checkbox-circle-line', title: 'Set Status Active', desc: 'Available for shipment assignment' },
    ],
  },

  // ---------- TRADE & COMMERCIAL ----------
  segments: {
    key: 'segments', slug: 'segments', title: 'Segments', titleSingular: 'Segment',
    icon: 'ri-focus-3-line', iconColor: 'success', iconBg: 'success',
    desc: 'Business lines classifying orders & products',
    cat: 'Trade & Commercial',
    fields: [
      { n: 'title', l: 'Segment Name', t: 'text', r: true, p: 'e.g. Dry Fruits, Pharma' },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['title', 'status'],
    colL: ['Segment Name', 'Status'],
    uFields: ['title'],
    data: [
      { id: 1, title: 'Dry Fruits', status: 'Active' },
      { id: 2, title: 'Agro-Chemicals', status: 'Active' },
      { id: 3, title: 'Spices & Condiments', status: 'Active' },
      { id: 4, title: 'Oil Seeds', status: 'Active' },
      { id: 5, title: 'Pulses', status: 'Active' },
      { id: 6, title: 'Vegetables', status: 'Active' },
      { id: 7, title: 'Fruits', status: 'Active' },
      { id: 8, title: 'Food Grains', status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-focus-3-line', title: 'Define Segment Name', desc: 'e.g. Dry Fruits, Pharma' },
      { icon: 'ri-file-chart-line', title: 'Groups Orders & Products', desc: 'Used in reporting & filtering' },
      { icon: 'ri-checkbox-circle-line', title: 'Set Status Active', desc: 'Segment available for tagging' },
    ],
  },

  hsn_codes: {
    key: 'hsn_codes', slug: 'hsn_codes', title: 'HSN Codes', titleSingular: 'HSN Code',
    icon: 'ri-file-code-line', iconColor: 'danger', iconBg: 'danger',
    desc: '8-digit commodity codes for GST & customs filings',
    cat: 'Trade & Commercial',
    fields: [
      { n: 'hsn_code', l: 'HSN Code', t: 'text', r: true, p: 'e.g. 08021200' },
      { n: 'description', l: 'Description', t: 'textarea', r: true, p: 'Product/commodity description', full: true },
      { n: 'gst_rate', l: 'GST Rate', t: 'select', opts: ['0%', '5%', '12%', '18%', '28%'] },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['hsn_code', 'description', 'gst_rate', 'status'],
    colL: ['HSN Code', 'Description', 'GST Rate', 'Status'],
    uFields: ['hsn_code'],
    data: [
      { id: 1, hsn_code: '08021200', description: 'Almonds — Shelled', gst_rate: '5%', status: 'Active' },
      { id: 2, hsn_code: '08062000', description: 'Raisins — Dried Grapes', gst_rate: '5%', status: 'Active' },
      { id: 3, hsn_code: '12074000', description: 'Sesame Seeds', gst_rate: '5%', status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-file-code-line', title: 'Enter 8-Digit HSN Code', desc: 'e.g. 08021200 for Almonds' },
      { icon: 'ri-money-rupee-circle-line', title: 'Set GST Rate', desc: '0% / 5% / 12% / 18% / 28%' },
      { icon: 'ri-file-list-3-line', title: 'Mandatory On B2B Invoices', desc: 'HSN needed for GST filing & customs' },
      { icon: 'ri-checkbox-circle-line', title: 'Set Status Active', desc: 'Code available for products' },
    ],
  },

  gst_percentage: {
    key: 'gst_percentage', slug: 'gst_percentage', title: 'GST Percentages', titleSingular: 'GST Percentage',
    icon: 'ri-percent-line', iconColor: 'success', iconBg: 'success',
    desc: 'GST tax slabs applied on product invoices',
    cat: 'Trade & Commercial',
    fields: [
      { n: 'percentage', l: 'GST %', t: 'number', r: true, p: 'e.g. 18' },
      { n: 'label', l: 'Label', t: 'text', p: 'e.g. GST 18%' },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['percentage', 'label', 'status'],
    colL: ['GST %', 'Label', 'Status'],
    uFields: ['percentage'],
    data: [
      { id: 1, percentage: 0, label: 'GST 0%', status: 'Active' },
      { id: 2, percentage: 5, label: 'GST 5%', status: 'Active' },
      { id: 3, percentage: 12, label: 'GST 12%', status: 'Active' },
      { id: 4, percentage: 18, label: 'GST 18%', status: 'Active' },
      { id: 5, percentage: 28, label: 'GST 28%', status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-percent-line', title: 'Enter GST %', desc: 'e.g. 0, 5, 12, 18, 28' },
      { icon: 'ri-price-tag-3-line', title: 'Add Label', desc: 'e.g. GST 18% — shown on invoice' },
      { icon: 'ri-checkbox-circle-line', title: 'Set Status Active', desc: 'Rate available for products' },
    ],
  },

  currencies: {
    key: 'currencies', slug: 'currencies', title: 'Currencies', titleSingular: 'Currency',
    icon: 'ri-money-dollar-circle-line', iconColor: 'warning', iconBg: 'warning',
    desc: 'Active currencies with exchange rates for export invoicing',
    cat: 'Trade & Commercial',
    fields: [
      { n: 'name', l: 'Currency Name', t: 'text', r: true, p: 'e.g. US Dollar' },
      { n: 'code', l: 'Code', t: 'text', r: true, p: 'e.g. USD' },
      { n: 'symbol', l: 'Symbol', t: 'text', r: true, p: 'e.g. $' },
      { n: 'exchange_rate', l: 'Exchange Rate (vs INR)', t: 'number', p: 'e.g. 83.50' },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['name', 'code', 'symbol', 'exchange_rate', 'status'],
    colL: ['Currency Name', 'Code', 'Symbol', 'Rate (INR)', 'Status'],
    uFields: ['code'],
    data: [
      { id: 1, name: 'US Dollar', code: 'USD', symbol: '$', exchange_rate: 83.50, status: 'Active' },
      { id: 2, name: 'Euro', code: 'EUR', symbol: '€', exchange_rate: 90.20, status: 'Active' },
      { id: 3, name: 'British Pound', code: 'GBP', symbol: '£', exchange_rate: 105.00, status: 'Inactive' },
      { id: 4, name: 'Indian Rupee', code: 'INR', symbol: '₹', exchange_rate: 1, status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-money-dollar-circle-line', title: 'Add Currency & Code', desc: 'e.g. US Dollar / USD' },
      { icon: 'ri-currency-line', title: 'Add Symbol', desc: 'e.g. $ € £ ₹ — shown on invoices' },
      { icon: 'ri-line-chart-line', title: 'Set Exchange Rate vs INR', desc: 'Updated manually per RBI rate' },
      { icon: 'ri-checkbox-circle-line', title: 'Set Status Active', desc: 'Currency for export invoicing' },
    ],
  },

  uom: {
    key: 'uom', slug: 'uom', title: 'Units of Measurement', titleSingular: 'Unit of Measurement',
    icon: 'ri-ruler-line', iconColor: 'info', iconBg: 'info',
    desc: 'Units (Kg, Box, Pcs) on product & shipment records',
    cat: 'Trade & Commercial',
    fields: [
      { n: 'title', l: 'Unit Title', t: 'text', r: true, p: 'e.g. Kilogram' },
      { n: 'short_code', l: 'Short Code', t: 'text', r: true, p: 'e.g. KG' },
      { n: 'unit_type', l: 'Unit Type', t: 'select', opts: ['Weight', 'Volume', 'Length', 'Area', 'Count', 'Other'] },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['title', 'short_code', 'unit_type', 'status'],
    colL: ['Unit Title', 'Short Code', 'Type', 'Status'],
    uFields: ['short_code'],
    data: [
      { id: 1, title: 'Kilogram', short_code: 'KG', unit_type: 'Weight', status: 'Active' },
      { id: 2, title: 'Metric Ton', short_code: 'MT', unit_type: 'Weight', status: 'Active' },
      { id: 3, title: 'Liter', short_code: 'LTR', unit_type: 'Volume', status: 'Active' },
      { id: 4, title: 'Piece', short_code: 'PCS', unit_type: 'Count', status: 'Active' },
      { id: 5, title: 'Box', short_code: 'BOX', unit_type: 'Count', status: 'Active' },
      { id: 6, title: 'Carton', short_code: 'CTN', unit_type: 'Count', status: 'Active' },
      { id: 7, title: 'Bag', short_code: 'BAG', unit_type: 'Count', status: 'Active' },
      { id: 8, title: 'Cubic Meter', short_code: 'CBM', unit_type: 'Volume', status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-ruler-line', title: 'Name the Unit', desc: 'e.g. Kilogram, Liter, Piece' },
      { icon: 'ri-hashtag', title: 'Add Short Code', desc: 'e.g. KG, LTR, PCS' },
      { icon: 'ri-price-tag-3-line', title: 'Set Unit Type', desc: 'Weight / Volume / Count / Length' },
      { icon: 'ri-checkbox-circle-line', title: 'Set Status Active', desc: 'Unit for products & shipments' },
    ],
  },

  packaging_material: {
    key: 'packaging_material', slug: 'packaging_material', title: 'Packaging Materials', titleSingular: 'Packaging Material',
    icon: 'ri-box-3-line', iconColor: 'warning', iconBg: 'warning',
    desc: 'Box, carton & wrapping types linked to packaging module',
    cat: 'Trade & Commercial',
    fields: [
      { n: 'title', l: 'Packaging Material', t: 'text', r: true, p: 'e.g. PP Bag, Gunny Bag' },
      { n: 'material_type', l: 'Material Type', t: 'select', opts: ['Bag', 'Box', 'Crate', 'Drum', 'Pallet', 'Wrap', 'Other'] },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['title', 'material_type', 'status'],
    colL: ['Material', 'Type', 'Status'],
    uFields: ['title'],
    data: [
      { id: 1, title: 'PP Bag', material_type: 'Bag', status: 'Active' },
      { id: 2, title: 'Gunny Bag', material_type: 'Bag', status: 'Active' },
      { id: 3, title: 'Plastic Crate', material_type: 'Crate', status: 'Active' },
      { id: 4, title: 'Wooden Crate', material_type: 'Crate', status: 'Active' },
      { id: 5, title: 'Corrugated Box', material_type: 'Box', status: 'Active' },
      { id: 6, title: 'Master Carton', material_type: 'Box', status: 'Active' },
      { id: 7, title: 'Pallet', material_type: 'Pallet', status: 'Active' },
      { id: 8, title: 'Jute Bag', material_type: 'Bag', status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-box-3-line', title: 'Name the Packaging', desc: 'e.g. PP Bag, Pallet, Drum' },
      { icon: 'ri-price-tag-3-line', title: 'Set Material Type', desc: 'Bag / Box / Crate / Drum / Pallet' },
      { icon: 'ri-file-list-3-line', title: 'On Packing Lists', desc: 'Type printed on export documents' },
      { icon: 'ri-checkbox-circle-line', title: 'Set Status Active', desc: 'Available in packing module' },
    ],
  },

  conditions: {
    key: 'conditions', slug: 'conditions', title: 'Product Conditions', titleSingular: 'Product Condition',
    icon: 'ri-leaf-line', iconColor: 'success', iconBg: 'success',
    desc: 'Storage & handling states (Organic, Fresh, Frozen)',
    cat: 'Trade & Commercial',
    fields: [
      { n: 'title', l: 'Condition Title', t: 'text', r: true, p: 'e.g. Organic, Fresh, Processed' },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['title', 'status'],
    colL: ['Condition', 'Status'],
    uFields: ['title'],
    data: [
      { id: 1, title: 'Organic', status: 'Active' },
      { id: 2, title: 'Fresh', status: 'Active' },
      { id: 3, title: 'Processed', status: 'Active' },
      { id: 4, title: 'Raw', status: 'Active' },
      { id: 5, title: 'Ambient', status: 'Active' },
      { id: 6, title: 'Cold Chain', status: 'Active' },
      { id: 7, title: 'Frozen', status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-leaf-line', title: 'Add Condition Name', desc: 'e.g. Organic, Cold Chain, Frozen' },
      { icon: 'ri-temp-cold-line', title: 'Controls Storage Routing', desc: 'Cold Chain → Freezer or Cold Zone' },
      { icon: 'ri-checkbox-circle-line', title: 'Set Status Active', desc: 'Condition tagged on products' },
    ],
  },

  incoterms: {
    key: 'incoterms', slug: 'incoterms', title: 'Incoterms', titleSingular: 'Incoterm',
    icon: 'ri-handshake-line', iconColor: 'primary', iconBg: 'primary',
    desc: 'Trade terms (FOB, CIF) defining delivery & risk',
    cat: 'Trade & Commercial',
    fields: [
      { n: 'code', l: 'Incoterm Code', t: 'text', r: true, p: 'e.g. FOB' },
      { n: 'full_name', l: 'Full Name', t: 'text', r: true, p: 'e.g. Free On Board' },
      { n: 'transport_mode', l: 'Transport Mode', t: 'select', opts: ['Sea/Inland Waterway', 'Any Mode', 'Air', 'Road', 'Rail'] },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['code', 'full_name', 'transport_mode', 'status'],
    colL: ['Code', 'Full Name', 'Transport Mode', 'Status'],
    uFields: ['code'],
    data: [
      { id: 1, code: 'FOB', full_name: 'Free On Board', transport_mode: 'Sea/Inland Waterway', status: 'Active' },
      { id: 2, code: 'CIF', full_name: 'Cost Insurance Freight', transport_mode: 'Sea/Inland Waterway', status: 'Active' },
      { id: 3, code: 'EXW', full_name: 'Ex Works', transport_mode: 'Any Mode', status: 'Active' },
      { id: 4, code: 'DDP', full_name: 'Delivered Duty Paid', transport_mode: 'Any Mode', status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-handshake-line', title: 'Add Incoterm Code', desc: 'e.g. FOB, CIF, EXW, DDP' },
      { icon: 'ri-ship-line', title: 'Define Transport Mode', desc: 'Sea / Air / Road / Any Mode' },
      { icon: 'ri-file-list-3-line', title: 'Printed On Invoices', desc: 'Defines delivery & risk transfer' },
      { icon: 'ri-checkbox-circle-line', title: 'Set Status Active', desc: 'Available for invoice creation' },
    ],
  },

  // ---------- PARTY & CLASSIFICATION ----------
  customer_types: {
    key: 'customer_types', slug: 'customer_types', title: 'Customer Types', titleSingular: 'Customer Type',
    icon: 'ri-user-3-line', iconColor: 'danger', iconBg: 'danger',
    desc: 'Classify buyers as Domestic / Export for pricing rules',
    cat: 'Party & Classification',
    fields: [
      { n: 'name', l: 'Customer Type', t: 'text', r: true, p: 'e.g. Domestic, Export' },
      { n: 'gst_applicable', l: 'GST Applicable', t: 'select', opts: ['Yes', 'No'] },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['name', 'gst_applicable', 'status'],
    colL: ['Customer Type', 'GST Applicable', 'Status'],
    uFields: ['name'],
    data: [
      { id: 1, name: 'Domestic', gst_applicable: 'Yes', status: 'Active' },
      { id: 2, name: 'Export', gst_applicable: 'No', status: 'Active' },
      { id: 3, name: 'Wholesale', gst_applicable: 'Yes', status: 'Active' },
      { id: 4, name: 'Retail', gst_applicable: 'Yes', status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-user-3-line', title: 'Define Customer Type', desc: 'e.g. Domestic, Export, Wholesale' },
      { icon: 'ri-money-rupee-circle-line', title: 'Set GST Applicable', desc: 'Domestic = Yes · Export = No' },
      { icon: 'ri-price-tag-3-line', title: 'Drives Pricing Rules', desc: 'Different price per customer type' },
      { icon: 'ri-checkbox-circle-line', title: 'Set Status Active', desc: 'Type for customer profiles' },
    ],
  },

  customer_classifications: {
    key: 'customer_classifications', slug: 'customer_classifications', title: 'Customer Classifications', titleSingular: 'Customer Classification',
    icon: 'ri-award-line', iconColor: 'primary', iconBg: 'primary',
    desc: 'Tier labels (A/B/C, Key Account) for credit & discount',
    cat: 'Party & Classification',
    fields: [
      { n: 'name', l: 'Classification Name', t: 'text', r: true, p: 'e.g. Tier A, Key Account' },
      { n: 'credit_limit', l: 'Credit Limit (₹)', t: 'number', p: 'e.g. 500000' },
      { n: 'payment_terms', l: 'Payment Terms (days)', t: 'number', p: 'e.g. 30' },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['name', 'credit_limit', 'payment_terms', 'status'],
    colL: ['Classification', 'Credit Limit', 'Payment Terms', 'Status'],
    uFields: ['name'],
    data: [
      { id: 1, name: 'Tier A — Key Account', credit_limit: 5000000, payment_terms: 45, status: 'Active' },
      { id: 2, name: 'Tier B — Regular', credit_limit: 1000000, payment_terms: 30, status: 'Active' },
      { id: 3, name: 'Tier C — New', credit_limit: 200000, payment_terms: 15, status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-award-line', title: 'Define Tier Name', desc: 'e.g. Tier A Key Account, Tier C New' },
      { icon: 'ri-bank-card-line', title: 'Set Credit Limit (₹)', desc: 'Max credit extended to this tier' },
      { icon: 'ri-calendar-line', title: 'Set Payment Terms', desc: 'e.g. 30, 45, 60 days' },
      { icon: 'ri-checkbox-circle-line', title: 'Set Status Active', desc: 'Classification for customers' },
    ],
  },

  vendor_types: {
    key: 'vendor_types', slug: 'vendor_types', title: 'Vendor Types', titleSingular: 'Vendor Type',
    icon: 'ri-store-2-line', iconColor: 'info', iconBg: 'info',
    desc: 'Supplier categories for procurement rules',
    cat: 'Party & Classification',
    fields: [
      { n: 'name', l: 'Vendor Type', t: 'text', r: true, p: 'e.g. Farmer, Trader' },
      { n: 'description', l: 'Description', t: 'textarea', p: 'Type description', full: true },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['name', 'description', 'status'],
    colL: ['Vendor Type', 'Description', 'Status'],
    uFields: ['name'],
    data: [
      { id: 1, name: 'Farmer', description: 'Direct farm sourcing', status: 'Active' },
      { id: 2, name: 'Trader', description: 'Commodity trader', status: 'Active' },
      { id: 3, name: 'Manufacturer', description: 'Processed goods manufacturer', status: 'Active' },
      { id: 4, name: 'Supplier', description: 'General goods supplier', status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-store-2-line', title: 'Define Vendor Type', desc: 'e.g. Farmer, Trader, Manufacturer' },
      { icon: 'ri-file-list-3-line', title: 'Used On Purchase Orders', desc: 'Vendor type shown on PO & reports' },
      { icon: 'ri-checkbox-circle-line', title: 'Set Status Active', desc: 'Type for vendor profiles' },
    ],
  },

  vendor_behaviour: {
    key: 'vendor_behaviour', slug: 'vendor_behaviour', title: 'Vendor Behaviour', titleSingular: 'Vendor Behaviour',
    icon: 'ri-pulse-line', iconColor: 'warning', iconBg: 'warning',
    desc: 'Performance tags used in purchase order workflows',
    cat: 'Party & Classification',
    fields: [
      { n: 'name', l: 'Behaviour Type', t: 'text', r: true, p: 'e.g. Excellent, Good' },
      { n: 'description', l: 'Description', t: 'textarea', p: 'Behaviour definition', full: true },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['name', 'description', 'status'],
    colL: ['Behaviour Type', 'Description', 'Status'],
    uFields: ['name'],
    data: [
      { id: 1, name: 'Excellent', description: 'Consistently exceeds expectations', status: 'Active' },
      { id: 2, name: 'Good', description: 'Meets expectations reliably', status: 'Active' },
      { id: 3, name: 'Average', description: 'Meets basic requirements', status: 'Active' },
      { id: 4, name: 'Poor', description: 'Below acceptable standards', status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-star-line', title: 'Define Performance Tag', desc: 'e.g. Excellent, Good, Poor' },
      { icon: 'ri-file-text-line', title: 'Set Behaviour Criteria', desc: 'What qualifies for this rating' },
      { icon: 'ri-price-tag-3-line', title: 'Used In PO Review', desc: 'Rating assigned on vendor evaluation' },
      { icon: 'ri-checkbox-circle-line', title: 'Set Status Active', desc: 'Behaviour for PO workflow' },
    ],
  },

  applicable_types: {
    key: 'applicable_types', slug: 'applicable_types', title: 'Applicable Parties', titleSingular: 'Applicable Party',
    icon: 'ri-team-fill', iconColor: 'success', iconBg: 'success',
    desc: 'Who appears on documents — Buyer, Consignee, Notify Party',
    cat: 'Party & Classification',
    fields: [
      { n: 'name', l: 'Party Name', t: 'text', r: true, p: 'e.g. Buyer, Consignee' },
      { n: 'party_type', l: 'Party Type', t: 'select', opts: ['Customer', 'Vendor', 'Third Party', 'Carrier', 'Other'] },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['name', 'party_type', 'status'],
    colL: ['Party Name', 'Party Type', 'Status'],
    uFields: ['name'],
    data: [
      { id: 1, name: 'Buyer', party_type: 'Customer', status: 'Active' },
      { id: 2, name: 'Consignee', party_type: 'Customer', status: 'Active' },
      { id: 3, name: 'Notify Party', party_type: 'Third Party', status: 'Active' },
      { id: 4, name: 'Vendor', party_type: 'Vendor', status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-team-fill', title: 'Define Party Role', desc: 'e.g. Buyer, Consignee, Notify Party' },
      { icon: 'ri-price-tag-3-line', title: 'Set Party Type', desc: 'Customer / Vendor / Third Party' },
      { icon: 'ri-file-list-3-line', title: 'Printed On Documents', desc: 'Party role on export invoices & docs' },
      { icon: 'ri-checkbox-circle-line', title: 'Set Status Active', desc: 'Available for document creation' },
    ],
  },

  // ---------- LEGAL & COMPLIANCE ----------
  license_name: {
    key: 'license_name', slug: 'license_name', title: 'License Types', titleSingular: 'License Type',
    icon: 'ri-file-shield-2-line', iconColor: 'danger', iconBg: 'danger',
    desc: 'Import/export license categories per product or market',
    cat: 'Legal & Compliance',
    fields: [
      { n: 'name', l: 'License Name', t: 'text', r: true, p: 'e.g. Drug Wholesale License' },
      { n: 'license_code', l: 'License Code', t: 'text', p: 'e.g. DWL' },
      { n: 'issuing_authority', l: 'Issuing Authority', t: 'text', p: 'e.g. CDSCO, FSSAI' },
      { n: 'validity_months', l: 'Validity (months)', t: 'number', p: '0 = lifetime' },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['name', 'license_code', 'issuing_authority', 'validity_months', 'status'],
    colL: ['License Name', 'Code', 'Authority', 'Validity', 'Status'],
    uFields: ['license_code'],
    data: [
      { id: 1, name: 'Drug Wholesale License', license_code: 'DWL', issuing_authority: 'CDSCO', validity_months: 12, status: 'Active' },
      { id: 2, name: 'FSSAI License', license_code: 'FSSAI', issuing_authority: 'FSSAI', validity_months: 12, status: 'Active' },
      { id: 3, name: 'IEC Code', license_code: 'IEC', issuing_authority: 'DGFT', validity_months: 0, status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-file-shield-2-line', title: 'Name the License', desc: 'e.g. Drug Wholesale License, FSSAI' },
      { icon: 'ri-government-line', title: 'Set Issuing Authority', desc: 'e.g. CDSCO, FSSAI, DGFT' },
      { icon: 'ri-calendar-line', title: 'Set Validity Period', desc: 'Months until renewal — 0 = lifetime' },
      { icon: 'ri-checkbox-circle-line', title: 'Set Status Active', desc: 'License tracked for compliance' },
    ],
  },

  risk_levels: {
    key: 'risk_levels', slug: 'risk_levels', title: 'Risk Levels', titleSingular: 'Risk Level',
    icon: 'ri-flashlight-line', iconColor: 'warning', iconBg: 'warning',
    desc: 'Risk severity tags for vendor & shipment screening',
    cat: 'Legal & Compliance',
    fields: [
      { n: 'name', l: 'Risk Level', t: 'text', r: true, p: 'e.g. Low, Medium, High' },
      { n: 'description', l: 'Description', t: 'text', p: 'Risk criteria' },
      { n: 'action_required', l: 'Action Required', t: 'text', p: 'e.g. Escalate' },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['name', 'description', 'action_required', 'status'],
    colL: ['Risk Level', 'Description', 'Action', 'Status'],
    uFields: ['name'],
    data: [
      { id: 1, name: 'Low', description: 'Minimal risk', action_required: 'None', status: 'Active' },
      { id: 2, name: 'Medium', description: 'Moderate risk', action_required: 'Verify', status: 'Active' },
      { id: 3, name: 'High', description: 'Significant risk', action_required: 'Escalate to manager', status: 'Active' },
      { id: 4, name: 'Critical', description: 'Severe risk', action_required: 'Block immediately', status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-flashlight-line', title: 'Define Risk Level', desc: 'e.g. Low, Medium, High, Critical' },
      { icon: 'ri-file-text-line', title: 'Set Risk Criteria', desc: 'What qualifies a vendor for this level' },
      { icon: 'ri-alarm-warning-line', title: 'Define Action Required', desc: 'e.g. Escalate / Block / Verify' },
      { icon: 'ri-checkbox-circle-line', title: 'Set Status Active', desc: 'Level used in vendor screening' },
    ],
  },

  document_type: {
    key: 'document_type', slug: 'document_type', title: 'Document Types', titleSingular: 'Document Type',
    icon: 'ri-file-text-line', iconColor: 'primary', iconBg: 'primary',
    desc: 'Document categories for upload & linking (Invoice, COA, SDS)',
    cat: 'Legal & Compliance',
    fields: [
      { n: 'title', l: 'Document Type Name', t: 'text', r: true, p: 'e.g. GST Registration Certificate' },
      { n: 'applicable_to', l: 'Applicable To', t: 'select', opts: ['Customer', 'Vendor', 'Both', 'Internal'] },
      { n: 'is_mandatory', l: 'Is Mandatory', t: 'select', opts: ['Yes', 'No'] },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['title', 'applicable_to', 'is_mandatory', 'status'],
    colL: ['Document Type', 'Applicable To', 'Mandatory', 'Status'],
    uFields: ['title'],
    data: [
      { id: 1, title: 'GST Registration Certificate', applicable_to: 'Both', is_mandatory: 'Yes', status: 'Active' },
      { id: 2, title: 'PAN Card', applicable_to: 'Both', is_mandatory: 'Yes', status: 'Active' },
      { id: 3, title: 'Trade License', applicable_to: 'Customer', is_mandatory: 'Yes', status: 'Active' },
      { id: 4, title: 'Aadhaar Card', applicable_to: 'Both', is_mandatory: 'No', status: 'Active' },
      { id: 5, title: 'Certificate of Analysis', applicable_to: 'Vendor', is_mandatory: 'Yes', status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-file-text-line', title: 'Name the Document Type', desc: 'e.g. GST Certificate, COA, PAN' },
      { icon: 'ri-price-tag-3-line', title: 'Set Applicable To', desc: 'Customer / Vendor / Both / Internal' },
      { icon: 'ri-star-line', title: 'Mark If Mandatory', desc: 'Mandatory = compliance alert if missing' },
      { icon: 'ri-checkbox-circle-line', title: 'Set Status Active', desc: 'Type used for document uploads' },
    ],
  },

  haz_class: {
    key: 'haz_class', slug: 'haz_class', title: 'Hazard Classifications', titleSingular: 'Hazard Classification',
    icon: 'ri-alert-line', iconColor: 'danger', iconBg: 'danger',
    desc: 'GHS/UN hazard classes for products requiring special handling',
    cat: 'Legal & Compliance',
    fields: [
      { n: 'name', l: 'Hazard Class', t: 'text', r: true, p: 'e.g. Flammable Liquid' },
      { n: 'haz_code', l: 'UN/GHS Code', t: 'text', p: 'e.g. UN1263' },
      { n: 'packing_group', l: 'Packing Group', t: 'select', opts: ['I (High Danger)', 'II (Medium Danger)', 'III (Low Danger)', 'N/A'] },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['name', 'haz_code', 'packing_group', 'status'],
    colL: ['Hazard Class', 'UN/GHS Code', 'Packing Group', 'Status'],
    uFields: ['haz_code'],
    data: [
      { id: 1, name: 'Flammable Liquid', haz_code: 'UN1263', packing_group: 'II (Medium Danger)', status: 'Active' },
      { id: 2, name: 'Toxic Substance', haz_code: 'UN2810', packing_group: 'III (Low Danger)', status: 'Active' },
      { id: 3, name: 'Non-Hazardous', haz_code: 'N/A', packing_group: 'N/A', status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-alert-line', title: 'Name the Hazard Class', desc: 'e.g. Flammable Liquid, Toxic' },
      { icon: 'ri-hashtag', title: 'Add UN/GHS Code', desc: 'e.g. UN1263 — regulatory reference' },
      { icon: 'ri-box-3-line', title: 'Set Packing Group', desc: 'I / II / III based on danger level' },
      { icon: 'ri-checkbox-circle-line', title: 'Set Status Active', desc: 'Class linked to product safety rules' },
    ],
  },

  compliance_behaviours: {
    key: 'compliance_behaviours', slug: 'compliance_behaviours', title: 'Compliance Behaviours', titleSingular: 'Compliance Behaviour',
    icon: 'ri-scales-3-line', iconColor: 'primary', iconBg: 'primary',
    desc: 'Rules for regulated, cold-chain & controlled substance handling',
    cat: 'Legal & Compliance',
    fields: [
      { n: 'name', l: 'Behaviour Name', t: 'text', r: true, p: 'e.g. Compliant, Under Review' },
      { n: 'action_required', l: 'Action Required', t: 'text', p: 'Next steps' },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['name', 'action_required', 'status'],
    colL: ['Behaviour Name', 'Action Required', 'Status'],
    uFields: ['name'],
    data: [
      { id: 1, name: 'Compliant', action_required: 'None', status: 'Active' },
      { id: 2, name: 'Non-Compliant', action_required: 'Issue correction notice', status: 'Active' },
      { id: 3, name: 'Under Review', action_required: 'Await audit', status: 'Active' },
      { id: 4, name: 'Exempt', action_required: 'Maintain records', status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-scales-3-line', title: 'Define Compliance Status', desc: 'e.g. Compliant, Non-Compliant' },
      { icon: 'ri-file-list-3-line', title: 'Set Action Required', desc: 'Steps needed for this status' },
      { icon: 'ri-history-line', title: 'Tracked Per Vendor', desc: 'Compliance status in audit trail' },
      { icon: 'ri-checkbox-circle-line', title: 'Set Status Active', desc: 'Available for compliance workflow' },
    ],
  },

  // ---------- OPERATIONS & SUPPORT ----------
  assets: {
    key: 'assets', slug: 'assets', title: 'Assets', titleSingular: 'Asset',
    icon: 'ri-briefcase-4-line', iconColor: 'info', iconBg: 'info',
    desc: 'Company equipment & assets for ops & depreciation tracking',
    cat: 'Operations & Support',
    fields: [
      { n: 'asset_name', l: 'Asset Name', t: 'text', r: true, p: 'e.g. HP Laptop 15s' },
      { n: 'asset_number', l: 'Asset Number', t: 'text', r: true, p: 'e.g. A-L-32' },
      { n: 'asset_type_id', l: 'Asset Category', t: 'select', r: true, ref: 'asset_categories', refL: 'name' },
      { n: 'assign_date', l: 'Assigned Date', t: 'date' },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive', 'Under Repair', 'Disposed'] },
    ],
    cols: ['asset_name', 'asset_number', 'asset_type_id', 'assign_date', 'status'],
    colL: ['Asset Name', 'Asset Number', 'Category', 'Assign Date', 'Status'],
    uFields: ['asset_number'],
    data: [{ id: 1, asset_name: 'HP Laptop 15s', asset_number: 'A-L-32', asset_type_id: 1, assign_date: '2026-03-28', status: 'Active' }],
    wtd: [
      { icon: 'ri-briefcase-4-line', title: 'Name the Asset', desc: 'e.g. HP Laptop 15s, Office Chair' },
      { icon: 'ri-hashtag', title: 'Assign Asset Number', desc: 'Unique ID — e.g. A-L-32' },
      { icon: 'ri-price-tag-3-line', title: 'Select Asset Category', desc: 'Links to depreciation & useful life' },
      { icon: 'ri-checkbox-circle-line', title: 'Set Status', desc: 'Active / Under Repair / Disposed' },
    ],
  },

  asset_categories: {
    key: 'asset_categories', slug: 'asset_categories', title: 'Asset Categories', titleSingular: 'Asset Category',
    icon: 'ri-price-tag-3-line', iconColor: 'warning', iconBg: 'warning',
    desc: 'Group assets by type (Machinery, IT, Furniture)',
    cat: 'Operations & Support',
    fields: [
      { n: 'name', l: 'Category Name', t: 'text', r: true, p: 'e.g. Laptop, Machinery' },
      { n: 'depreciation_rate', l: 'Depreciation Rate (% pa)', t: 'number', p: 'e.g. 33' },
      { n: 'useful_life_years', l: 'Useful Life (years)', t: 'number', p: 'e.g. 3' },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['name', 'depreciation_rate', 'useful_life_years', 'status'],
    colL: ['Category Name', 'Dep. Rate %', 'Useful Life', 'Status'],
    uFields: ['name'],
    data: [
      { id: 1, name: 'Laptop', depreciation_rate: 33, useful_life_years: 3, status: 'Active' },
      { id: 2, name: 'Desktop Computer', depreciation_rate: 33, useful_life_years: 3, status: 'Active' },
      { id: 3, name: 'Office Furniture', depreciation_rate: 10, useful_life_years: 10, status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-price-tag-3-line', title: 'Name the Category', desc: 'e.g. Laptop, Machinery, Furniture' },
      { icon: 'ri-line-chart-line', title: 'Set Depreciation Rate', desc: '% per year — e.g. 33% for IT assets' },
      { icon: 'ri-calendar-line', title: 'Set Useful Life (Years)', desc: 'e.g. 3 years for computers' },
      { icon: 'ri-checkbox-circle-line', title: 'Set Status Active', desc: 'Category for asset tagging' },
    ],
  },

  // ---------- P2P MASTERS ----------
  payment_terms: {
    key: 'payment_terms', slug: 'payment_terms', title: 'Payment Terms', titleSingular: 'Payment Term',
    icon: 'ri-calendar-line', iconColor: 'info', iconBg: 'info',
    desc: 'Credit days, advance %, milestone structure for PO terms',
    cat: 'P2P Masters',
    fields: [
      { n: 'term_code', l: 'Term Code', t: 'text', r: true, p: 'e.g. NET30, ADV100' },
      { n: 'term_name', l: 'Term Name', t: 'text', r: true, p: 'e.g. Net 30 Days' },
      { n: 'credit_days', l: 'Credit Days', t: 'number', r: true, p: 'e.g. 30' },
      { n: 'advance_pct', l: 'Advance Required (%)', t: 'number', p: 'e.g. 30' },
      { n: 'payment_type', l: 'Payment Type', t: 'select', r: true, opts: ['Full Advance', 'Partial Advance', 'Credit', 'Milestone-Based', 'COD'] },
      { n: 'milestone_desc', l: 'Milestone Description', t: 'text', p: 'e.g. 50% on dispatch, 50% on delivery' },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['term_code', 'term_name', 'credit_days', 'advance_pct', 'payment_type', 'status'],
    colL: ['Code', 'Term Name', 'Credit Days', 'Advance %', 'Payment Type', 'Status'],
    uFields: ['term_code'],
    data: [
      { id: 1, term_code: 'ADV100', term_name: '100% Advance', credit_days: 0, advance_pct: 100, payment_type: 'Full Advance', milestone_desc: '', status: 'Active' },
      { id: 2, term_code: 'NET30', term_name: 'Net 30 Days', credit_days: 30, advance_pct: 0, payment_type: 'Credit', milestone_desc: '', status: 'Active' },
      { id: 3, term_code: 'NET45', term_name: 'Net 45 Days', credit_days: 45, advance_pct: 0, payment_type: 'Credit', milestone_desc: '', status: 'Active' },
      { id: 4, term_code: 'ADV50', term_name: '50% Advance + 50% on Delivery', credit_days: 0, advance_pct: 50, payment_type: 'Milestone-Based', milestone_desc: '50% advance, 50% on GRN confirmation', status: 'Active' },
      { id: 5, term_code: 'COD', term_name: 'Cash on Delivery', credit_days: 0, advance_pct: 0, payment_type: 'COD', milestone_desc: '', status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-calendar-line', title: 'Name the Term', desc: 'e.g. Net 30, Advance 100%' },
      { icon: 'ri-hashtag', title: 'Set Credit Days', desc: 'Days allowed before payment is due' },
      { icon: 'ri-money-rupee-circle-line', title: 'Set Advance %', desc: 'Advance % required before dispatch' },
      { icon: 'ri-checkbox-circle-line', title: 'Set Status Active', desc: 'Term appears in PO creation form' },
    ],
  },

  approval_authority: {
    key: 'approval_authority', slug: 'approval_authority', title: 'Approval Authority', titleSingular: 'Approval Authority',
    icon: 'ri-shield-check-line', iconColor: 'primary', iconBg: 'primary',
    desc: 'Value threshold + role matrix for PO, VTI, and Payment approvals',
    cat: 'P2P Masters',
    fields: [
      { n: 'role_name', l: 'Approver Role', t: 'text', r: true, p: 'e.g. Purchase Manager' },
      { n: 'module_scope', l: 'Module Scope', t: 'select', r: true, opts: ['Purchase Order', 'Payment', 'VTI', 'GRN', 'All'] },
      { n: 'min_value', l: 'Min Value (₹)', t: 'number', p: 'e.g. 0' },
      { n: 'max_value', l: 'Max Value (₹)', t: 'number', r: true, p: 'e.g. 500000' },
      { n: 'currency', l: 'Currency', t: 'select', opts: ['INR', 'USD', 'EUR', 'GBP'] },
      { n: 'escalate_to', l: 'Escalate To (Role)', t: 'text', p: 'If threshold exceeded' },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['role_name', 'module_scope', 'min_value', 'max_value', 'escalate_to', 'status'],
    colL: ['Approver Role', 'Module Scope', 'Min Value (₹)', 'Max Value (₹)', 'Escalate To', 'Status'],
    uFields: ['role_name', 'module_scope'],
    data: [
      { id: 1, role_name: 'Purchase Executive', module_scope: 'Purchase Order', min_value: 0, max_value: 50000, currency: 'INR', escalate_to: 'Purchase Manager', status: 'Active' },
      { id: 2, role_name: 'Purchase Manager', module_scope: 'Purchase Order', min_value: 50001, max_value: 500000, currency: 'INR', escalate_to: 'Director', status: 'Active' },
      { id: 3, role_name: 'Director', module_scope: 'All', min_value: 500001, max_value: 99999999, currency: 'INR', escalate_to: '', status: 'Active' },
      { id: 4, role_name: 'Finance Executive', module_scope: 'Payment', min_value: 0, max_value: 100000, currency: 'INR', escalate_to: 'Finance Manager', status: 'Active' },
      { id: 5, role_name: 'Finance Manager', module_scope: 'Payment', min_value: 100001, max_value: 1000000, currency: 'INR', escalate_to: 'Director', status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-user-settings-line', title: 'Set Designation', desc: 'Who is the approver' },
      { icon: 'ri-money-rupee-circle-line', title: 'Set Value Threshold', desc: 'Max amount this role can approve' },
      { icon: 'ri-stack-line', title: 'Link Procurement Category', desc: 'Goods / Services / AMC scope' },
      { icon: 'ri-shield-check-line', title: 'Set Module Scope', desc: 'PO / Payment / VTI / GRN' },
    ],
  },

  procurement_category: {
    key: 'procurement_category', slug: 'procurement_category', title: 'Procurement Category', titleSingular: 'Procurement Category',
    icon: 'ri-stack-line', iconColor: 'success', iconBg: 'success',
    desc: 'Goods / Services / AMC / Job Work — drives 3-way vs 2-way match',
    cat: 'P2P Masters',
    fields: [
      { n: 'cat_code', l: 'Category Code', t: 'text', r: true, p: 'e.g. GDS, SVC' },
      { n: 'cat_name', l: 'Category Name', t: 'text', r: true, p: 'e.g. Goods, Services' },
      { n: 'match_logic', l: 'Match Logic', t: 'select', r: true, opts: ['3-Way Match (PO+VTI+GRN)', '2-Way Match (PO+VTI)', '4-Way Match (PO+VTI+GRN+QC)'] },
      { n: 'grn_required', l: 'GRN Required', t: 'select', r: true, opts: ['Yes — Physical Receipt', 'Yes — Service Confirmation', 'No'] },
      { n: 'gst_applicable', l: 'GST Applicable', t: 'select', r: true, opts: ['Yes', 'No', 'Reverse Charge'] },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['cat_code', 'cat_name', 'match_logic', 'grn_required', 'gst_applicable', 'status'],
    colL: ['Code', 'Category Name', 'Match Logic', 'GRN Required', 'GST', 'Status'],
    uFields: ['cat_code'],
    data: [
      { id: 1, cat_code: 'GDS', cat_name: 'Goods', match_logic: '3-Way Match (PO+VTI+GRN)', grn_required: 'Yes — Physical Receipt', gst_applicable: 'Yes', status: 'Active' },
      { id: 2, cat_code: 'SVC', cat_name: 'Services', match_logic: '2-Way Match (PO+VTI)', grn_required: 'Yes — Service Confirmation', gst_applicable: 'Yes', status: 'Active' },
      { id: 3, cat_code: 'AMC', cat_name: 'Annual Maintenance Contract', match_logic: '2-Way Match (PO+VTI)', grn_required: 'Yes — Service Confirmation', gst_applicable: 'Yes', status: 'Active' },
      { id: 4, cat_code: 'JOB', cat_name: 'Job Work', match_logic: '3-Way Match (PO+VTI+GRN)', grn_required: 'Yes — Physical Receipt', gst_applicable: 'Yes', status: 'Active' },
      { id: 5, cat_code: 'IMP', cat_name: 'Import', match_logic: '4-Way Match (PO+VTI+GRN+QC)', grn_required: 'Yes — Physical Receipt', gst_applicable: 'No', status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-stack-line', title: 'Define Category Code', desc: 'e.g. GDS, SVC, AMC, JOB' },
      { icon: 'ri-file-list-3-line', title: 'Name the Category', desc: 'e.g. Goods, Services, Job Work' },
      { icon: 'ri-git-commit-line', title: 'Set Match Logic', desc: '3-Way Match or 2-Way Match' },
      { icon: 'ri-checkbox-circle-line', title: 'GRN Required?', desc: 'Physical receipt or service proof' },
    ],
  },

  sourcing_type: {
    key: 'sourcing_type', slug: 'sourcing_type', title: 'Sourcing Type', titleSingular: 'Sourcing Type',
    icon: 'ri-price-tag-line', iconColor: 'info', iconBg: 'info',
    desc: 'Direct / Open Market / Spot / Rate Contract classifications',
    cat: 'P2P Masters',
    fields: [
      { n: 'type_code', l: 'Type Code', t: 'text', r: true, p: 'e.g. DIR, SPOT' },
      { n: 'type_name', l: 'Sourcing Type Name', t: 'text', r: true, p: 'e.g. Direct Purchase' },
      { n: 'quotation_required', l: 'Quotation Required', t: 'select', r: true, opts: ['Mandatory — Min 3 Quotes', 'Mandatory — Min 1 Quote', 'Optional', 'Not Required'] },
      { n: 'approval_required', l: 'Approval Required', t: 'select', r: true, opts: ['Yes', 'No'] },
      { n: 'urgency_flag', l: 'Urgency Flag', t: 'select', opts: ['Normal', 'Urgent', 'Emergency'] },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['type_code', 'type_name', 'quotation_required', 'approval_required', 'urgency_flag', 'status'],
    colL: ['Code', 'Sourcing Type', 'Quotation Rule', 'Approval?', 'Urgency', 'Status'],
    uFields: ['type_code'],
    data: [
      { id: 1, type_code: 'DIR', type_name: 'Direct Purchase', quotation_required: 'Mandatory — Min 1 Quote', approval_required: 'Yes', urgency_flag: 'Normal', status: 'Active' },
      { id: 2, type_code: 'OMK', type_name: 'Open Market', quotation_required: 'Mandatory — Min 3 Quotes', approval_required: 'Yes', urgency_flag: 'Normal', status: 'Active' },
      { id: 3, type_code: 'SPOT', type_name: 'Spot Purchase', quotation_required: 'Optional', approval_required: 'Yes', urgency_flag: 'Urgent', status: 'Active' },
      { id: 4, type_code: 'RC', type_name: 'Rate Contract', quotation_required: 'Not Required', approval_required: 'No', urgency_flag: 'Normal', status: 'Active' },
      { id: 5, type_code: 'EMG', type_name: 'Emergency Purchase', quotation_required: 'Not Required', approval_required: 'Yes', urgency_flag: 'Emergency', status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-price-tag-line', title: 'Define Type Code', desc: 'e.g. DIR, OMK, SPOT, RC' },
      { icon: 'ri-file-list-3-line', title: 'Name the Sourcing Type', desc: 'e.g. Direct Purchase, Open Market' },
      { icon: 'ri-checkbox-circle-line', title: 'Quotation Required?', desc: 'Is comparative quotation mandatory' },
      { icon: 'ri-flashlight-line', title: 'Set Urgency Flag', desc: 'Spot / Emergency overrides normal flow' },
    ],
  },

  deviation_reason: {
    key: 'deviation_reason', slug: 'deviation_reason', title: 'Override / Deviation Reason', titleSingular: 'Deviation Reason',
    icon: 'ri-error-warning-line', iconColor: 'danger', iconBg: 'danger',
    desc: 'Locked picklist for all manual override actions',
    cat: 'P2P Masters',
    fields: [
      { n: 'reason_code', l: 'Reason Code', t: 'text', r: true, p: 'e.g. RATE-REV' },
      { n: 'reason_name', l: 'Reason Name', t: 'text', r: true, p: 'e.g. Rate Revised Post Negotiation' },
      { n: 'module', l: 'Applicable Module', t: 'select', r: true, opts: ['Purchase Order', 'Vendor Comparison', 'VTI', 'GRN', 'Payment', 'All'] },
      { n: 'attachment_required', l: 'Attachment Required', t: 'select', r: true, opts: ['Yes', 'No'] },
      { n: 'requires_approval', l: 'Requires Approval', t: 'select', r: true, opts: ['Yes', 'No'] },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['reason_code', 'reason_name', 'module', 'attachment_required', 'requires_approval', 'status'],
    colL: ['Code', 'Reason Name', 'Module', 'Attachment?', 'Needs Approval', 'Status'],
    uFields: ['reason_code'],
    data: [
      { id: 1, reason_code: 'RATE-REV', reason_name: 'Rate Revised Post Negotiation', module: 'Purchase Order', attachment_required: 'Yes', requires_approval: 'Yes', status: 'Active' },
      { id: 2, reason_code: 'VND-CHG', reason_name: 'Vendor Changed — Original Unavailable', module: 'Vendor Comparison', attachment_required: 'Yes', requires_approval: 'Yes', status: 'Active' },
      { id: 3, reason_code: 'QTY-SHORT', reason_name: 'Partial Delivery — Short Quantity GRN', module: 'GRN', attachment_required: 'No', requires_approval: 'No', status: 'Active' },
      { id: 4, reason_code: 'GRN-REJ', reason_name: 'Material Rejected — Quality Failure', module: 'GRN', attachment_required: 'Yes', requires_approval: 'Yes', status: 'Active' },
      { id: 5, reason_code: 'DATE-EXT', reason_name: 'Delivery Date Extended by Vendor', module: 'Purchase Order', attachment_required: 'No', requires_approval: 'Yes', status: 'Active' },
      { id: 6, reason_code: 'TAX-CORR', reason_name: 'Tax Rate Correction on VTI', module: 'VTI', attachment_required: 'Yes', requires_approval: 'Yes', status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-hashtag', title: 'Define Reason Code', desc: 'Short code — e.g. VND-CHG, RATE-REV' },
      { icon: 'ri-file-text-line', title: 'Name the Reason', desc: 'Clear description of deviation' },
      { icon: 'ri-stack-line', title: 'Set Applicable Module', desc: 'PO / VTI / GRN / Comparison' },
      { icon: 'ri-attachment-line', title: 'Attachment Required?', desc: 'Force evidence upload for this reason' },
    ],
  },

  match_exception: {
    key: 'match_exception', slug: 'match_exception', title: 'Match Exception Type', titleSingular: 'Match Exception Type',
    icon: 'ri-git-commit-line', iconColor: 'warning', iconBg: 'warning',
    desc: 'Exception types + resolver role for 3-way match engine',
    cat: 'P2P Masters',
    fields: [
      { n: 'exc_code', l: 'Exception Code', t: 'text', r: true, p: 'e.g. QTY-TOL' },
      { n: 'exc_name', l: 'Exception Name', t: 'text', r: true, p: 'e.g. Quantity Tolerance Breach' },
      { n: 'tolerance_pct', l: 'Tolerance % Allowed', t: 'number', p: 'e.g. 2' },
      { n: 'blocks_payment', l: 'Blocks Payment', t: 'select', r: true, opts: ['Yes — Hard Block', 'Yes — Soft Block (Warning)', 'No'] },
      { n: 'resolver_role', l: 'Resolver Role', t: 'text', r: true, p: 'e.g. Purchase Manager' },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['exc_code', 'exc_name', 'tolerance_pct', 'blocks_payment', 'resolver_role', 'status'],
    colL: ['Code', 'Exception Name', 'Tolerance %', 'Blocks Payment', 'Resolver Role', 'Status'],
    uFields: ['exc_code'],
    data: [
      { id: 1, exc_code: 'QTY-TOL', exc_name: 'Quantity Tolerance Breach', tolerance_pct: 2, blocks_payment: 'Yes — Soft Block (Warning)', resolver_role: 'Purchase Manager', status: 'Active' },
      { id: 2, exc_code: 'RATE-VAR', exc_name: 'Rate Variance vs PO', tolerance_pct: 0, blocks_payment: 'Yes — Hard Block', resolver_role: 'Purchase Manager', status: 'Active' },
      { id: 3, exc_code: 'TAX-MIS', exc_name: 'GST Rate Mismatch — VTI vs PO', tolerance_pct: 0, blocks_payment: 'Yes — Hard Block', resolver_role: 'Finance Manager', status: 'Active' },
      { id: 4, exc_code: 'GRN-MISS', exc_name: 'GRN Not Done — Goods Category', tolerance_pct: 0, blocks_payment: 'Yes — Hard Block', resolver_role: 'Warehouse Manager', status: 'Active' },
      { id: 5, exc_code: 'DUP-INV', exc_name: 'Duplicate Invoice Number', tolerance_pct: 0, blocks_payment: 'Yes — Hard Block', resolver_role: 'Finance Executive', status: 'Active' },
      { id: 6, exc_code: 'PO-EXP', exc_name: 'PO Validity Expired', tolerance_pct: 0, blocks_payment: 'Yes — Hard Block', resolver_role: 'Purchase Manager', status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-hashtag', title: 'Define Exception Code', desc: 'Short code — e.g. QTY-TOL, RATE-VAR' },
      { icon: 'ri-file-text-line', title: 'Name the Exception', desc: 'Clear label shown on match screen' },
      { icon: 'ri-percent-line', title: 'Set Tolerance %', desc: 'Allowed variance % before exception fires' },
      { icon: 'ri-user-settings-line', title: 'Set Resolver Role', desc: 'Who must resolve before payment releases' },
    ],
  },

  advance_payment_rules: {
    key: 'advance_payment_rules', slug: 'advance_payment_rules', title: 'Advance Payment Rules', titleSingular: 'Advance Payment Rule',
    icon: 'ri-bank-card-line', iconColor: 'primary', iconBg: 'primary',
    desc: 'Max advance % per vendor type / category + approval matrix',
    cat: 'P2P Masters',
    fields: [
      { n: 'vendor_type', l: 'Vendor Type', t: 'text', r: true, p: 'e.g. Farmer, Trader, Manufacturer' },
      { n: 'procurement_cat', l: 'Procurement Category', t: 'text', p: 'e.g. Goods, Services' },
      { n: 'max_advance_pct', l: 'Max Advance Allowed (%)', t: 'number', r: true, p: 'e.g. 30' },
      { n: 'approval_above', l: 'Extra Approval Above (₹)', t: 'number', p: 'e.g. 100000' },
      { n: 'approver_role', l: 'Approver Role', t: 'text', p: 'e.g. Finance Manager' },
      { n: 'attachment_required', l: 'PO/Quote Attachment Required', t: 'select', r: true, opts: ['Yes', 'No'] },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['vendor_type', 'procurement_cat', 'max_advance_pct', 'approval_above', 'approver_role', 'status'],
    colL: ['Vendor Type', 'Proc. Category', 'Max Advance %', 'Extra Approval Above (₹)', 'Approver', 'Status'],
    uFields: ['vendor_type', 'procurement_cat'],
    data: [
      { id: 1, vendor_type: 'Farmer', procurement_cat: 'Goods', max_advance_pct: 50, approval_above: 100000, approver_role: 'Purchase Manager', attachment_required: 'Yes', status: 'Active' },
      { id: 2, vendor_type: 'Trader', procurement_cat: 'Goods', max_advance_pct: 30, approval_above: 200000, approver_role: 'Finance Manager', attachment_required: 'Yes', status: 'Active' },
      { id: 3, vendor_type: 'Manufacturer', procurement_cat: 'Goods', max_advance_pct: 25, approval_above: 500000, approver_role: 'Director', attachment_required: 'Yes', status: 'Active' },
      { id: 4, vendor_type: 'Supplier', procurement_cat: 'Services', max_advance_pct: 20, approval_above: 50000, approver_role: 'Purchase Manager', attachment_required: 'Yes', status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-price-tag-3-line', title: 'Select Vendor Type', desc: 'Rule applies to which vendor category' },
      { icon: 'ri-money-rupee-circle-line', title: 'Set Max Advance %', desc: 'Maximum % allowed as advance' },
      { icon: 'ri-shield-check-line', title: 'Set Approval Threshold', desc: 'Amount above which extra approval needed' },
      { icon: 'ri-attachment-line', title: 'Attachment Required?', desc: 'Force PO copy / quotation for advance' },
    ],
  },

  exchange_rate_log: {
    key: 'exchange_rate_log', slug: 'exchange_rate_log', title: 'Currency Exchange Rate Log', titleSingular: 'Exchange Rate Entry',
    icon: 'ri-refresh-line', iconColor: 'info', iconBg: 'info',
    desc: 'Date-wise exchange rate history vs INR for multi-currency',
    cat: 'P2P Masters',
    fields: [
      { n: 'currency_code', l: 'Currency Code', t: 'text', r: true, p: 'e.g. USD' },
      { n: 'currency_name', l: 'Currency Name', t: 'text', p: 'e.g. US Dollar' },
      { n: 'rate_vs_inr', l: 'Rate vs INR', t: 'number', r: true, p: 'e.g. 83.45' },
      { n: 'effective_date', l: 'Effective Date', t: 'date', r: true },
      { n: 'rate_source', l: 'Rate Source', t: 'select', r: true, opts: ['RBI Reference Rate', 'Bank Rate', 'Agreed Rate', 'Custom'] },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Superseded'] },
    ],
    cols: ['currency_code', 'rate_vs_inr', 'effective_date', 'rate_source', 'status'],
    colL: ['Currency', 'Rate vs INR', 'Effective Date', 'Rate Source', 'Status'],
    uFields: ['currency_code', 'effective_date'],
    data: [
      { id: 1, currency_code: 'USD', currency_name: 'US Dollar', rate_vs_inr: 83.45, effective_date: '2026-04-01', rate_source: 'RBI Reference Rate', status: 'Active' },
      { id: 2, currency_code: 'EUR', currency_name: 'Euro', rate_vs_inr: 90.12, effective_date: '2026-04-01', rate_source: 'RBI Reference Rate', status: 'Active' },
      { id: 3, currency_code: 'GBP', currency_name: 'British Pound', rate_vs_inr: 105.30, effective_date: '2026-04-01', rate_source: 'RBI Reference Rate', status: 'Active' },
      { id: 4, currency_code: 'AED', currency_name: 'UAE Dirham', rate_vs_inr: 22.70, effective_date: '2026-04-01', rate_source: 'RBI Reference Rate', status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-money-dollar-circle-line', title: 'Select Currency', desc: 'e.g. USD, EUR, GBP' },
      { icon: 'ri-calendar-line', title: 'Set Effective Date', desc: 'Date from which rate is valid' },
      { icon: 'ri-line-chart-line', title: 'Enter Exchange Rate', desc: 'Rate vs INR — e.g. 1 USD = 83.45 INR' },
      { icon: 'ri-bank-line', title: 'Set Rate Source', desc: 'RBI / Bank / Custom' },
    ],
  },

  goods_service_flag: {
    key: 'goods_service_flag', slug: 'goods_service_flag', title: 'Goods vs Service Flag', titleSingular: 'Goods/Service Flag',
    icon: 'ri-toggle-line', iconColor: 'danger', iconBg: 'danger',
    desc: 'Switches GRN logic between physical receipt and service proof',
    cat: 'P2P Masters',
    fields: [
      { n: 'flag_code', l: 'Flag Code', t: 'text', r: true, p: 'e.g. GDS' },
      { n: 'flag_name', l: 'Flag Name', t: 'text', r: true, p: 'e.g. Goods' },
      { n: 'grn_screen', l: 'GRN Screen Logic', t: 'select', r: true, opts: ['Physical Receipt — Qty + Batch + Warehouse', 'Service Completion — Date + Proof Doc', 'Mixed — Partial Goods + Service'] },
      { n: 'evidence_type', l: 'Evidence Required', t: 'text', r: true, p: 'e.g. Delivery Challan, Completion Certificate' },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['flag_code', 'flag_name', 'grn_screen', 'evidence_type', 'status'],
    colL: ['Code', 'Flag Name', 'GRN Screen Logic', 'Evidence Required', 'Status'],
    uFields: ['flag_code'],
    data: [
      { id: 1, flag_code: 'GDS', flag_name: 'Goods', grn_screen: 'Physical Receipt — Qty + Batch + Warehouse', evidence_type: 'Delivery Challan / Gate Entry Slip', status: 'Active' },
      { id: 2, flag_code: 'SVC', flag_name: 'Services', grn_screen: 'Service Completion — Date + Proof Doc', evidence_type: 'Service Completion Certificate / Work Order Closure', status: 'Active' },
      { id: 3, flag_code: 'MIX', flag_name: 'Mixed (Goods + Service)', grn_screen: 'Mixed — Partial Goods + Service', evidence_type: 'Delivery Challan + Completion Certificate', status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-price-tag-3-line', title: 'Define Flag Code', desc: 'e.g. GDS, SVC' },
      { icon: 'ri-file-text-line', title: 'Name the Flag', desc: 'Goods or Service — clear label' },
      { icon: 'ri-file-list-3-line', title: 'GRN Logic', desc: 'Physical receipt or service completion proof' },
      { icon: 'ri-attachment-line', title: 'Evidence Required', desc: 'What attachment proves completion' },
    ],
  },

  vendor_directory: {
    key: 'vendor_directory', slug: 'vendor_directory', title: 'Vendor Directory', titleSingular: 'Vendor Directory Entry',
    icon: 'ri-contacts-book-line', iconColor: 'primary', iconBg: 'primary',
    desc: 'Vendor information, addresses & document verification',
    cat: 'P2P Masters',
    fields: [
      { n: 'vendor_company_name', l: 'Vendor Company Name', t: 'text', r: true, p: 'e.g. TechParts India Pvt Ltd' },
      { n: 'contact_person', l: 'Contact Person', t: 'text', r: true, p: 'Primary contact name' },
      { n: 'mobile_number', l: 'Mobile Number', t: 'text', r: true, p: '10-digit mobile' },
      { n: 'email_id', l: 'Email ID', t: 'email', r: true, p: 'vendor@company.com' },
      { n: 'segment_id', l: 'Segment', t: 'select', r: true, ref: 'segments', refL: 'title' },
      { n: 'address', l: 'Address', t: 'text', r: true, p: 'e.g. 101, Business Park, MG Road' },
      { n: 'country', l: 'Country', t: 'select', r: true, opts: ['India', 'USA', 'UAE', 'UK', 'Germany', 'Australia', 'Singapore', 'Other'] },
      { n: 'state', l: 'State', t: 'select', r: true, ref: 'states', refL: 'name' },
      { n: 'city', l: 'City', t: 'text', r: true, p: 'City name' },
      { n: 'mapping_mode', l: 'Mapping Mode', t: 'select', r: true, opts: ['Map from Vendor Master', 'Map New Vendor'] },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['vendor_company_name', 'contact_person', 'mobile_number', 'segment_id', 'city', 'state', 'status'],
    colL: ['Vendor Company', 'Contact Person', 'Mobile', 'Segment', 'City', 'State', 'Status'],
    uFields: ['vendor_company_name', 'mobile_number'],
    data: [
      { id: 1, vendor_company_name: 'TechParts India Pvt Ltd', contact_person: 'Ramesh Joshi', mobile_number: '9876543210', email_id: 'ramesh@techparts.in', segment_id: 1, address: '101, Business Park, MG Road', country: 'India', state: 1, city: 'Pune', mapping_mode: 'Map from Vendor Master', status: 'Active' },
      { id: 2, vendor_company_name: 'Agro Supplies Co.', contact_person: 'Suresh Patil', mobile_number: '9823456780', email_id: 'suresh@agrosupplies.in', segment_id: 2, address: 'Plot 5, MIDC, Satara Road', country: 'India', state: 1, city: 'Satara', mapping_mode: 'Map New Vendor', status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-building-line', title: 'Vendor Company Name', desc: 'Legal company name — mandatory' },
      { icon: 'ri-user-line', title: 'Contact Person + Mobile', desc: 'Primary contact with 10-digit mobile' },
      { icon: 'ri-map-pin-line', title: 'Full Address', desc: 'Address, Country, State, City' },
      { icon: 'ri-focus-3-line', title: 'Select Segment', desc: 'Vendor category / business segment' },
    ],
  },

  // ---------- WAREHOUSE MASTERS ----------
  warehouse_master: {
    key: 'warehouse_master', slug: 'warehouse_master', title: 'Warehouse Master', titleSingular: 'Warehouse',
    icon: 'ri-building-2-line', iconColor: 'success', iconBg: 'success',
    desc: 'Define all warehouse locations — Own & Third Party',
    cat: 'Warehouse Masters',
    fields: [
      { n: 'wh_id', l: 'Warehouse ID', t: 'text', r: true, p: 'e.g. WH-001' },
      { n: 'wh_name', l: 'Warehouse Name', t: 'text', r: true, p: 'e.g. Pune Main' },
      { n: 'wh_type', l: 'Warehouse Type', t: 'select', r: true, opts: ['Own Warehouse', 'Third Party Warehouse'] },
      { n: 'city', l: 'City', t: 'text', r: true, p: 'e.g. Pune' },
      { n: 'state', l: 'State', t: 'text', p: 'e.g. Maharashtra' },
      { n: 'pincode', l: 'PIN Code', t: 'text', p: 'e.g. 411045' },
      { n: 'contact_person', l: 'Contact Person', t: 'text', p: 'e.g. Rajesh Kumar' },
      { n: 'contact_phone', l: 'Contact Phone', t: 'text', p: 'e.g. +91 98000 00000' },
      { n: 'area_sqft', l: 'Area (sq. ft.)', t: 'number', p: 'e.g. 25000' },
      { n: 'address', l: 'Full Address', t: 'textarea', p: 'Full warehouse address', full: true },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['wh_id', 'wh_name', 'wh_type', 'city', 'contact_person', 'status'],
    colL: ['WH ID', 'Warehouse Name', 'Type', 'City', 'Contact Person', 'Status'],
    uFields: ['wh_id'],
    data: [
      { id: 1, wh_id: 'WH-001', wh_name: 'Pune Main', wh_type: 'Own Warehouse', city: 'Pune', state: 'Maharashtra', pincode: '411045', contact_person: 'Rajesh Kumar', contact_phone: '+91 98100 00001', area_sqft: 25000, address: 'Solitaire Hub, Balewadi, Pune', status: 'Active' },
      { id: 2, wh_id: 'WH-002', wh_name: 'Mumbai Hub', wh_type: 'Own Warehouse', city: 'Mumbai', state: 'Maharashtra', pincode: '400001', contact_person: 'Priya Mehta', contact_phone: '+91 98100 00002', area_sqft: 40000, address: 'JNPT Industrial Area, Mumbai', status: 'Active' },
      { id: 3, wh_id: 'WH-003', wh_name: 'Nashik', wh_type: 'Third Party Warehouse', city: 'Nashik', state: 'Maharashtra', pincode: '422001', contact_person: 'Suresh Patil', contact_phone: '+91 98100 00003', area_sqft: 18000, address: 'MIDC Ambad, Nashik', status: 'Active' },
      { id: 4, wh_id: 'WH-004', wh_name: 'Nagpur', wh_type: 'Third Party Warehouse', city: 'Nagpur', state: 'Maharashtra', pincode: '440001', contact_person: 'Amit Shah', contact_phone: '+91 98100 00004', area_sqft: 15000, address: 'Butibori MIDC, Nagpur', status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-building-2-line', title: 'Assign Warehouse ID', desc: 'Unique code — e.g. WH-001' },
      { icon: 'ri-price-tag-3-line', title: 'Set Warehouse Type', desc: 'Own Warehouse or Third Party' },
      { icon: 'ri-map-pin-line', title: 'Add Location', desc: 'City, state, pincode, address' },
      { icon: 'ri-user-line', title: 'Add Contact Person', desc: 'Name & phone of warehouse in-charge' },
    ],
  },

  zone_master: {
    key: 'zone_master', slug: 'zone_master', title: 'Zone Master', titleSingular: 'Zone',
    icon: 'ri-map-2-line', iconColor: 'success', iconBg: 'success',
    desc: 'Storage zones inside warehouses — Storage, Cold Chain, Hazmat',
    cat: 'Warehouse Masters',
    fields: [
      { n: 'zone_id', l: 'Zone ID', t: 'text', r: true, p: 'e.g. ZN-001' },
      { n: 'zone_name', l: 'Zone Name', t: 'text', r: true, p: 'e.g. Zone A — Storage' },
      { n: 'zone_type', l: 'Zone Type', t: 'select', r: true, opts: ['Storage Zone', 'Cold Chain Zone', 'Hazardous Zone', 'Dispatch Zone', 'Holding Zone', 'QC Hold Zone', 'Overflow Zone', 'Blocked Zone', 'Regulated Zone'] },
      { n: 'warehouse', l: 'Warehouse', t: 'select', r: true, ref: 'warehouse_master', refL: 'wh_name' },
      { n: 'purpose', l: 'Zone Purpose', t: 'textarea', p: 'Describe what this zone is used for', full: true },
      { n: 'cold_chain', l: 'Cold Chain Allowed', t: 'select', opts: ['No', 'Yes'] },
      { n: 'hazardous', l: 'Hazardous Allowed', t: 'select', opts: ['No', 'Yes'] },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['zone_id', 'zone_name', 'zone_type', 'warehouse', 'cold_chain', 'hazardous', 'status'],
    colL: ['Zone ID', 'Zone Name', 'Zone Type', 'Warehouse', 'Cold Chain', 'Hazardous', 'Status'],
    uFields: ['zone_id'],
    data: [
      { id: 1, zone_id: 'ZN-001', zone_name: 'Zone A — Storage', zone_type: 'Storage Zone', warehouse: 1, purpose: 'General goods storage', cold_chain: 'No', hazardous: 'No', status: 'Active' },
      { id: 2, zone_id: 'ZN-002', zone_name: 'Zone B — Cold', zone_type: 'Cold Chain Zone', warehouse: 1, purpose: 'Temperature-controlled storage', cold_chain: 'Yes', hazardous: 'No', status: 'Active' },
      { id: 3, zone_id: 'ZN-003', zone_name: 'Zone C — Dispatch', zone_type: 'Dispatch Zone', warehouse: 2, purpose: 'Outward dispatch staging area', cold_chain: 'No', hazardous: 'No', status: 'Active' },
      { id: 4, zone_id: 'ZN-004', zone_name: 'Zone D — Hazmat', zone_type: 'Hazardous Zone', warehouse: 3, purpose: 'Hazardous material storage', cold_chain: 'No', hazardous: 'Yes', status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-hashtag', title: 'Assign Zone ID & Name', desc: 'e.g. ZN-001, Zone A — Storage' },
      { icon: 'ri-price-tag-3-line', title: 'Select Zone Type', desc: 'Storage / Cold Chain / Hazardous / Dispatch' },
      { icon: 'ri-building-2-line', title: 'Link to Warehouse', desc: 'Which warehouse this zone belongs to' },
      { icon: 'ri-shield-check-line', title: 'Set Zone Permissions', desc: 'Putaway / Pickup / Dispatch / Cold Chain' },
    ],
  },

  rack_type_master: {
    key: 'rack_type_master', slug: 'rack_type_master', title: 'Rack Type Master', titleSingular: 'Rack Type',
    icon: 'ri-stack-line', iconColor: 'primary', iconBg: 'primary',
    desc: 'Rack types used across warehouses — Pallet, Cold, Hazardous',
    cat: 'Warehouse Masters',
    fields: [
      { n: 'type_code', l: 'Type Code', t: 'text', r: true, p: 'e.g. PLT' },
      { n: 'type_name', l: 'Rack Type Name', t: 'text', r: true, p: 'e.g. Pallet Rack' },
      { n: 'description', l: 'Description', t: 'textarea', p: 'What this rack type is used for', full: true },
      { n: 'suitable_for', l: 'Suitable For', t: 'select', opts: ['General Inventory', 'Cold Chain', 'Hazardous', 'Heavy Duty', 'Retail', 'Pharma', 'All Types'] },
      { n: 'max_load_per_shelf', l: 'Max Load Per Shelf (kg)', t: 'number', p: 'e.g. 500' },
      { n: 'typical_shelves', l: 'Typical Shelf Levels', t: 'number', p: 'e.g. 4' },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['type_code', 'type_name', 'suitable_for', 'max_load_per_shelf', 'typical_shelves', 'status'],
    colL: ['Code', 'Rack Type', 'Suitable For', 'Max Load/Shelf (kg)', 'Typical Levels', 'Status'],
    uFields: ['type_code', 'type_name'],
    data: [
      { id: 1, type_code: 'PLT', type_name: 'Pallet Rack', description: 'Standard selective pallet racking for bulk storage', suitable_for: 'General Inventory', max_load_per_shelf: 1000, typical_shelves: 4, status: 'Active' },
      { id: 2, type_code: 'FLR', type_name: 'Floor Rack', description: 'Ground-level floor rack for heavy or bulk items', suitable_for: 'Heavy Duty', max_load_per_shelf: 3000, typical_shelves: 2, status: 'Active' },
      { id: 3, type_code: 'CLD', type_name: 'Cool Rack', description: 'Temperature-resistant rack for cold chain storage', suitable_for: 'Cold Chain', max_load_per_shelf: 800, typical_shelves: 3, status: 'Active' },
      { id: 4, type_code: 'HAZ', type_name: 'Hazardous Rack', description: 'Isolated rack with safety features for hazmat goods', suitable_for: 'Hazardous', max_load_per_shelf: 500, typical_shelves: 2, status: 'Active' },
      { id: 5, type_code: 'CNT', type_name: 'Cantilever Rack', description: 'Open-arm rack for long or irregularly shaped items', suitable_for: 'General Inventory', max_load_per_shelf: 1500, typical_shelves: 5, status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-price-tag-3-line', title: 'Define Type Code', desc: 'Short code — e.g. PLT, CLD, HAZ' },
      { icon: 'ri-file-text-line', title: 'Name the Rack Type', desc: 'e.g. Pallet Rack, Cool Rack' },
      { icon: 'ri-box-3-line', title: 'Set Suitable Products', desc: 'What goods this rack type holds' },
      { icon: 'ri-scales-line', title: 'Set Max Load Per Shelf', desc: 'Load capacity in kilograms' },
    ],
  },

  temp_class_master: {
    key: 'temp_class_master', slug: 'temp_class_master', title: 'Temperature Class Master', titleSingular: 'Temperature Class',
    icon: 'ri-temp-cold-line', iconColor: 'info', iconBg: 'info',
    desc: 'Temperature classifications for controlled storage',
    cat: 'Warehouse Masters',
    fields: [
      { n: 'class_code', l: 'Class Code', t: 'text', r: true, p: 'e.g. AMB' },
      { n: 'class_name', l: 'Temperature Class', t: 'text', r: true, p: 'e.g. Ambient' },
      { n: 'temp_range_min', l: 'Min Temperature (°C)', t: 'number', p: 'e.g. 15' },
      { n: 'temp_range_max', l: 'Max Temperature (°C)', t: 'number', p: 'e.g. 30' },
      { n: 'description', l: 'Description', t: 'textarea', p: 'What products go here', full: true },
      { n: 'requires_monitoring', l: 'Requires Monitoring', t: 'select', opts: ['No', 'Yes'] },
      { n: 'alert_threshold', l: 'Alert Threshold (°C)', t: 'number', p: 'Alert if exceeded' },
      { n: 'suitable_products', l: 'Suitable Products', t: 'text', p: 'e.g. Dry goods, Grains, FMCG' },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['class_code', 'class_name', 'temp_range_min', 'temp_range_max', 'requires_monitoring', 'status'],
    colL: ['Code', 'Temperature Class', 'Min Temp (°C)', 'Max Temp (°C)', 'Monitoring', 'Status'],
    uFields: ['class_code', 'class_name'],
    data: [
      { id: 1, class_code: 'AMB', class_name: 'Ambient', temp_range_min: 15, temp_range_max: 35, description: 'Standard room temperature for dry goods, FMCG, general inventory', requires_monitoring: 'No', alert_threshold: 40, suitable_products: 'Dry goods, Grains, FMCG, Packaging', status: 'Active' },
      { id: 2, class_code: 'RMT', class_name: 'Room Temperature', temp_range_min: 18, temp_range_max: 25, description: 'Controlled room temperature for pharma and sensitive goods', requires_monitoring: 'Yes', alert_threshold: 28, suitable_products: 'Pharma, Cosmetics, Electronics', status: 'Active' },
      { id: 3, class_code: 'CLD', class_name: 'Cold Chain', temp_range_min: 2, temp_range_max: 8, description: 'Refrigerated storage for perishables and temperature-sensitive products', requires_monitoring: 'Yes', alert_threshold: 10, suitable_products: 'Dairy, Fresh Produce, Vaccines, Biologics', status: 'Active' },
      { id: 4, class_code: 'FRZ', class_name: 'Frozen', temp_range_min: -25, temp_range_max: -18, description: 'Deep freeze storage for frozen goods and long-term preservation', requires_monitoring: 'Yes', alert_threshold: -15, suitable_products: 'Frozen Foods, Ice Cream, Meat', status: 'Active' },
      { id: 5, class_code: 'HAZ', class_name: 'Hazardous', temp_range_min: 15, temp_range_max: 30, description: 'Controlled environment for hazardous, flammable or regulated materials', requires_monitoring: 'Yes', alert_threshold: 35, suitable_products: 'Chemicals, SCOMET, Flammables', status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-temp-cold-line', title: 'Define Class Code', desc: 'Short code — e.g. AMB, CLD, FRZ' },
      { icon: 'ri-hashtag', title: 'Set Temperature Range', desc: 'Min and max °C for this class' },
      { icon: 'ri-alarm-warning-line', title: 'Set Alert Threshold', desc: 'Alert if temperature is exceeded' },
      { icon: 'ri-box-3-line', title: 'List Suitable Products', desc: 'What products belong in this class' },
    ],
  },

  racks: {
    key: 'racks', slug: 'racks', title: 'Rack & Location Master', titleSingular: 'Rack',
    icon: 'ri-layout-row-line', iconColor: 'primary', iconBg: 'primary',
    desc: 'Warehouse structure — Warehouse → Zone → Rack → Shelf',
    cat: 'Warehouse Masters',
    fields: [
      { n: 'whType', l: 'Warehouse Type', t: 'select', r: true, opts: ['Own Warehouse', 'Third Party Warehouse'] },
      { n: 'warehouse', l: 'Warehouse', t: 'select', r: true, ref: 'warehouse_master', refL: 'wh_name' },
      { n: 'zone', l: 'Zone', t: 'select', r: true, ref: 'zone_master', refL: 'zone_name' },
      { n: 'rackName', l: 'Rack Name', t: 'text', r: true, p: 'e.g. RC-001' },
      { n: 'rackType', l: 'Rack Type', t: 'select', r: true, ref: 'rack_type_master', refL: 'type_name' },
      { n: 'rackStatus', l: 'Rack Status', t: 'select', r: true, opts: ['Partially Filled', 'Full', 'Blocked', 'Reserved', 'Under Maintenance', 'Empty'] },
      { n: 'tempClass', l: 'Temperature Class', t: 'select', ref: 'temp_class_master', refL: 'class_name' },
      { n: 'shelves', l: 'Shelves / Levels', t: 'number', p: 'e.g. 4' },
      { n: 'maxWeight', l: 'Max Weight (kg)', t: 'number', p: 'e.g. 2000' },
      { n: 'maxVolume', l: 'Max Volume (m³)', t: 'number', p: 'e.g. 12' },
    ],
    cols: ['warehouse', 'zone', 'rackName', 'rackType', 'rackStatus', 'tempClass'],
    colL: ['Warehouse', 'Zone', 'Rack Name', 'Rack Type', 'Status', 'Temp Class'],
    uFields: ['rackName'],
    data: [
      { id: 1, whType: 'Own Warehouse', warehouse: 1, zone: 1, rackName: 'RC-001', rackType: 1, rackStatus: 'Partially Filled', shelves: 4, maxWeight: 2000, maxVolume: 12, tempClass: 1 },
      { id: 2, whType: 'Own Warehouse', warehouse: 1, zone: 2, rackName: 'RI-001', rackType: 3, rackStatus: 'Partially Filled', shelves: 3, maxWeight: 1500, maxVolume: 8, tempClass: 3 },
      { id: 3, whType: 'Own Warehouse', warehouse: 2, zone: 3, rackName: 'RC-002', rackType: 2, rackStatus: 'Full', shelves: 2, maxWeight: 3000, maxVolume: 18, tempClass: 1 },
      { id: 4, whType: 'Third Party Warehouse', warehouse: 3, zone: 4, rackName: 'RH-001', rackType: 4, rackStatus: 'Reserved', shelves: 2, maxWeight: 800, maxVolume: 5, tempClass: 5 },
    ],
    wtd: [
      { icon: 'ri-building-2-line', title: 'Select Warehouse & Zone', desc: 'Warehouse → Zone → then Rack' },
      { icon: 'ri-stack-line', title: 'Name & Type the Rack', desc: 'Rack Name + Type (Pallet, Cool…)' },
      { icon: 'ri-temp-cold-line', title: 'Set Temperature Class', desc: 'Ambient / Cold Chain / Hazardous' },
      { icon: 'ri-ruler-line', title: 'Enter Dimensions', desc: 'Shelves, Weight, Volume limits' },
    ],
  },

  shelf_master: {
    key: 'shelf_master', slug: 'shelf_master', title: 'Shelf / Level Master', titleSingular: 'Shelf',
    icon: 'ri-layout-grid-line', iconColor: 'primary', iconBg: 'primary',
    desc: 'Add and manage shelves (levels) inside each rack',
    cat: 'Warehouse Masters',
    fields: [
      { n: 'rack_ref', l: 'Rack', t: 'select', r: true, ref: 'racks', refL: 'rackName' },
      { n: 'shelf_name', l: 'Shelf Name', t: 'text', r: true, p: 'e.g. Shelf A1-L1' },
      { n: 'level_no', l: 'Level Number', t: 'number', r: true, p: 'e.g. 1' },
      { n: 'shelf_type', l: 'Shelf Type', t: 'select', r: true, opts: ['Standard Shelf', 'Cold Shelf', 'Heavy Duty Shelf', 'Cantilever Shelf', 'Mesh Shelf', 'Wire Deck Shelf'] },
      { n: 'max_weight', l: 'Max Weight (kg)', t: 'number', p: 'e.g. 500' },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Available', 'Partially Used', 'Full', 'Blocked', 'Under Maintenance'] },
    ],
    cols: ['shelf_name', 'rack_ref', 'level_no', 'shelf_type', 'max_weight', 'status'],
    colL: ['Shelf Name', 'Rack', 'Level', 'Type', 'Max Weight (kg)', 'Status'],
    uFields: ['shelf_name'],
    data: [],
    wtd: [
      { icon: 'ri-stack-line', title: 'Select Rack', desc: 'Pick warehouse → rack to add shelves' },
      { icon: 'ri-hashtag', title: 'Set Level Number', desc: 'Level 1 = bottom, Level N = top' },
      { icon: 'ri-ruler-line', title: 'Set Dimensions', desc: 'Height, Width, Depth per shelf' },
      { icon: 'ri-scales-line', title: 'Set Max Weight', desc: 'Max load this shelf can carry (kg)' },
    ],
  },

  digital_twin: {
    key: 'digital_twin', slug: 'digital_twin', title: 'Digital Twin', titleSingular: 'Digital Twin Entry',
    icon: 'ri-computer-line', iconColor: 'dark', iconBg: 'dark',
    desc: 'Visual warehouse location view — Warehouse → Zone → Rack',
    cat: 'Warehouse Masters',
    fields: [
      { n: 'name', l: 'View Name', t: 'text', r: true, p: 'e.g. Pune Main 3D View' },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['name', 'status'],
    colL: ['View Name', 'Status'],
    uFields: ['name'],
    data: [],
    wtd: [
      { icon: 'ri-computer-line', title: 'Visual Warehouse Map', desc: 'See Warehouse → Zone → Rack → Shelf hierarchy' },
      { icon: 'ri-pie-chart-line', title: 'Live Occupancy', desc: 'Color-coded fill bars per rack' },
      { icon: 'ri-cursor-line', title: 'Click Any Rack', desc: 'Sidebar shows full rack + shelf detail' },
      { icon: 'ri-filter-line', title: 'Filter by Warehouse', desc: 'Scope view to one or all warehouses' },
    ],
  },

  freezers: {
    key: 'freezers', slug: 'freezers', title: 'Freezer Management', titleSingular: 'Freezer',
    icon: 'ri-snowy-line', iconColor: 'info', iconBg: 'info',
    desc: 'Cold storage units — direct placement, no bins required',
    cat: 'Warehouse Masters',
    fields: [
      { n: 'name', l: 'Freezer Name', t: 'text', r: true, p: 'e.g. Freezer Alpha' },
      { n: 'warehouse', l: 'Warehouse', t: 'select', r: true, ref: 'warehouse_master', refL: 'wh_name' },
      { n: 'capacity', l: 'Capacity (Boxes)', t: 'number', r: true, p: 'e.g. 200' },
      { n: 'status', l: 'Status', t: 'select', r: true, opts: ['Active', 'Inactive'] },
    ],
    cols: ['name', 'warehouse', 'capacity', 'occupancy', 'status'],
    colL: ['Freezer Name', 'Warehouse', 'Capacity', 'Occupancy', 'Status'],
    uFields: ['name', 'warehouse'],
    data: [
      { id: 1, name: 'Freezer Alpha', warehouse: 1, capacity: 200, occupancy: 140, status: 'Active' },
      { id: 2, name: 'Freezer Beta', warehouse: 1, capacity: 150, occupancy: 150, status: 'Active' },
      { id: 3, name: 'Cold Zone A', warehouse: 2, capacity: 300, occupancy: 60, status: 'Active' },
      { id: 4, name: 'Cold Zone B', warehouse: 2, capacity: 300, occupancy: 0, status: 'Inactive' },
      { id: 5, name: 'Freezer Gamma', warehouse: 3, capacity: 100, occupancy: 90, status: 'Active' },
    ],
    wtd: [
      { icon: 'ri-snowy-line', title: 'Name the Freezer Unit', desc: 'e.g. Freezer Alpha, Cold Zone A' },
      { icon: 'ri-building-2-line', title: 'Link to Warehouse', desc: 'Which warehouse it belongs to' },
      { icon: 'ri-box-3-line', title: 'Set Capacity (Boxes)', desc: 'Total boxes this freezer can hold' },
      { icon: 'ri-pie-chart-line', title: 'Track Occupancy', desc: 'Used vs Free vs Total capacity shown' },
    ],
  },
};

export function getMasterConfig(slug: string): MasterConfig | null {
  return C[slug] || null;
}

export function allMasterConfigs(): MasterConfig[] {
  return Object.values(C);
}

// Resolve a reference field value to its display label.
export function resolveRef(refMaster: string, refLabel: string | undefined, value: any): string {
  const m = C[refMaster];
  if (!m) return String(value ?? '');
  const row = m.data.find(r => String(r.id) === String(value));
  if (!row) return String(value ?? '');
  return String(row[refLabel || 'name'] ?? value);
}
