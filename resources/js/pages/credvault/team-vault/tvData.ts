import { cvApi, type CredentialRow, type ListResponse, type Loose, type Risk, type Twofa, type Via } from '../cvApi';
import { initials } from '../shared';
import { LV_ORDER, type Level } from './tvShared';

/**
 * Team Vault's data source.
 *
 * The screen is in its design phase, so it runs on the prototype's dummy
 * organisation and credentials: eight departments, 84 members, 30 team and
 * 12 personal credentials. The fixtures answer the same four calls, in the
 * same shapes, as the live API, so the components do not know which one they
 * are reading. Set TV_DUMMY to false to go back to the live API.
 */
export const TV_DUMMY = true;

/* ── Organisation ─────────────────────────────────────────────────────────── */

const ADMIN = 'Rajesh Healthcare';

/** Level counts per department, in LV_ORDER: admin, hod, tl, exec, emp, intern. */
const DEPTS: { id: number; name: string; hod: string; lv: number[] }[] = [
  { id: 1, name: 'IT', hod: 'Arjun Mehta', lv: [1, 1, 2, 3, 5, 2] },
  { id: 2, name: 'Sales', hod: 'Rakesh Shinde', lv: [1, 1, 2, 3, 4, 1] },
  { id: 3, name: 'HR', hod: 'Aarti Mishra', lv: [1, 1, 2, 2, 2, 2] },
  { id: 4, name: 'Purchase & Procurement', hod: 'Priya Sharma', lv: [1, 1, 2, 3, 3, 1] },
  { id: 5, name: 'Logistics', hod: 'Chetan Raut', lv: [1, 1, 2, 2, 3, 2] },
  { id: 6, name: 'Digital Marketing', hod: 'Dipti Sharma', lv: [1, 1, 2, 3, 4, 1] },
  { id: 7, name: 'Accounts', hod: 'Arvind Nair', lv: [1, 1, 2, 3, 3, 2] },
  { id: 8, name: 'General Administration', hod: 'Rahul Gupta', lv: [1, 1, 1, 2, 3, 1] },
];

const FIRST = ['Neha', 'Rohan', 'Sneha', 'Amit', 'Pooja', 'Vikram', 'Kavya', 'Siddharth', 'Ananya', 'Karan', 'Ishita', 'Manish',
  'Divya', 'Rahul', 'Shruti', 'Aditya', 'Meera', 'Nikhil', 'Tanvi', 'Harsh', 'Riya', 'Omkar', 'Sakshi', 'Varun'];
const LAST = ['Patil', 'Kulkarni', 'Deshmukh', 'Joshi', 'Iyer', 'Reddy', 'Kapoor', 'Verma', 'Bhosale', 'Menon', 'Chavan', 'Gupta',
  'Pawar', 'Nair', 'Saxena', 'Jadhav'];
const DESIG: Record<Exclude<Level, 'admin'>, string> = {
  hod: 'Head of Department', tl: 'Team Lead', exec: 'Senior Executive', emp: 'Associate', intern: 'Intern',
};

/** levels[] in the API's shape, from a department's counts. */
const levelList = (lv: number[]) => LV_ORDER.map((level, i) => ({ level, count: lv[i] ?? 0 }));

/**
 * A department's members, flat with manager_employee_id, as the API sends
 * them: the HOD on top, the team leads under the HOD, everyone else shared
 * round the team leads. The admin is not a member; the tree adds them on top.
 */
function membersOf(d: (typeof DEPTS)[number]): Loose[] {
  const out: Loose[] = [];
  const add = (level: Exclude<Level, 'admin'>, name: string, manager: number | null) => {
    const employee_id = d.id * 100 + out.length + 1;
    out.push({ employee_id, name, initials: initials(name), designation: DESIG[level], level, manager_employee_id: manager, department: { id: d.id, name: d.name } });
    return employee_id;
  };
  const person = (n: number) => `${FIRST[(d.id * 5 + n) % FIRST.length]} ${LAST[(d.id * 3 + n * 7) % LAST.length]}`;

  const [, , tl, exec, emp, intern] = d.lv;
  const hod = add('hod', d.hod, null);
  const leads = Array.from({ length: tl }, (_, i) => add('tl', person(i), hod));
  const under = (i: number) => (leads.length ? leads[i % leads.length] : hod);
  let n = tl;
  for (let i = 0; i < exec; i++) add('exec', person(n++), under(i));
  for (let i = 0; i < emp; i++) add('emp', person(n++), under(i + exec));
  for (let i = 0; i < intern; i++) add('intern', person(n++), under(i));
  return out;
}

const MEMBERS = new Map(DEPTS.map(d => [d.id, membersOf(d)]));
const allMembers = () => DEPTS.flatMap(d => MEMBERS.get(d.id)!);
const deptOfEmployee = (employeeId: number) => Math.floor(employeeId / 100);

/* ── Credentials ──────────────────────────────────────────────────────────── */

const TYPES: Record<string, [label: string, group: string]> = {
  login: ['Login', 'Logins & Access'],
  email: ['Email', 'Logins & Access'],
  passkey: ['Passkey', 'Logins & Access'],
  totp: ['TOTP / 2FA Seed', 'Logins & Access'],
  bank: ['Bank Account', 'Finance & Banking'],
  card: ['Credit Card', 'Finance & Banking'],
  api: ['API Credentials', 'Development & IT'],
  server: ['Server', 'Development & IT'],
  database: ['Database', 'Development & IT'],
  license: ['Software License', 'Development & IT'],
  wifi: ['Wireless Router', 'Development & IT'],
  govid: ['SSN / Aadhaar / PAN', 'Identity & Documents'],
  passport: ['Passport', 'Identity & Documents'],
  driver: ['Driver License', 'Identity & Documents'],
  membership: ['Membership', 'Personal & Lifestyle'],
  medical: ['Medical Record', 'Personal & Lifestyle'],
};
const STRENGTH = ['', 'Weak', 'Fair', 'Good', 'Strong'];

/**
 * [type, name, sub line, username, owner, department id, risk, strength 0-4
 *  (0 = no password), 2FA, shared with you, hours since last update]
 */
type Seed = [string, string, string, string, string, number, Risk, number, Twofa, boolean, number];

const TEAM: Seed[] = [
  ['login', 'Tally Prime Cloud', 'https://tallyprime.cloud', 'accounts@inorbvict.com', 'Ruchi Gupta', 7, 'high', 3, 'yes', false, 5],
  ['login', 'IndiaMART Seller Panel', 'https://seller.indiamart.com', 'sales@inorbvict.com', 'Priya Sharma', 2, 'medium', 2, 'no', true, 24],
  ['login', 'Razorpay Settlement Dashboard', 'https://dashboard.razorpay.com', 'accounts@inorbvict.com', 'Arvind Nair', 7, 'critical', 4, 'no', false, 76],
  ['email', 'Procurement Mailbox', 'Google Workspace', 'procurement@inorbvict.com', 'Priya Sharma', 4, 'high', 3, 'yes', false, 81],
  ['bank', 'Kotak Vendor Payments A/c', 'Kotak Mahindra Bank', 'XXXX 5518', 'Ruchi Gupta', 7, 'critical', 3, 'yes', false, 99],
  ['passkey', 'GitHub Organisation', 'https://github.com/inorbvict', 'devops@inorbvict.com', 'Arjun Mehta', 1, 'medium', 0, 'yes', true, 119],
  ['login', 'TDS TRACES Portal', 'https://www.tdscpc.gov.in', 'PNEI01234B', 'Ruchi Gupta', 7, 'critical', 4, 'yes', false, 122],
  ['server', 'AWS Root Account', 'AWS Console', 'root@inorbvict.com', 'Arjun Mehta', 1, 'critical', 4, 'yes', false, 143],
  ['login', 'GST Portal', 'https://www.gst.gov.in', 'inorbvict_gst', 'Arvind Nair', 7, 'critical', 3, 'no', false, 160],
  ['login', 'DGFT Exporter Login', 'https://www.dgft.gov.in', 'IEC0516xxxx', 'Rakesh Shinde', 2, 'high', 3, 'yes', false, 171],
  ['email', 'Sales Team Inbox', 'Microsoft 365', 'sales@inorbvict.com', 'Rakesh Shinde', 2, 'high', 2, 'yes', false, 190],
  ['login', 'Zoho CRM', 'https://crm.zoho.in', 'crm.admin@inorbvict.com', 'Rakesh Shinde', 2, 'medium', 3, 'yes', false, 214],
  ['login', 'LinkedIn Recruiter', 'https://www.linkedin.com/talent', 'hr@inorbvict.com', 'Aarti Mishra', 3, 'medium', 2, 'no', false, 230],
  ['login', 'Naukri RMS', 'https://recruit.naukri.com', 'hiring@inorbvict.com', 'Aarti Mishra', 3, 'medium', 3, 'no', true, 251],
  ['database', 'Payroll Database', 'PostgreSQL · payroll-db', 'payroll_ro', 'Aarti Mishra', 3, 'critical', 4, 'na', false, 268],
  ['login', 'Maersk Booking Portal', 'https://www.maersk.com', 'bookings@inorbvict.com', 'Chetan Raut', 5, 'high', 3, 'yes', false, 290],
  ['login', 'ICEGATE e-Filing', 'https://www.icegate.gov.in', 'inorbvict_cha', 'Chetan Raut', 5, 'critical', 3, 'no', false, 305],
  ['wifi', 'Warehouse Wi-Fi', 'Bhiwandi Warehouse', 'WH-BHW-5G', 'Chetan Raut', 5, 'low', 2, 'na', false, 333],
  ['login', 'Meta Business Suite', 'https://business.facebook.com', 'marketing@inorbvict.com', 'Dipti Sharma', 6, 'high', 3, 'yes', false, 350],
  ['login', 'Google Ads', 'https://ads.google.com', 'ads@inorbvict.com', 'Dipti Sharma', 6, 'high', 4, 'yes', true, 371],
  ['api', 'Mailchimp API Key', 'https://mailchimp.com', 'us21 · marketing', 'Dipti Sharma', 6, 'medium', 4, 'na', false, 395],
  ['login', 'Canva Teams', 'https://www.canva.com', 'design@inorbvict.com', 'Dipti Sharma', 6, 'low', 2, 'no', false, 420],
  ['card', 'Corporate Amex Card', 'American Express', 'XXXX 1009', 'Arvind Nair', 7, 'critical', 0, 'na', false, 444],
  ['login', 'SAP Ariba Supplier', 'https://service.ariba.com', 'vendor@inorbvict.com', 'Priya Sharma', 4, 'high', 3, 'yes', false, 470],
  ['login', 'GeM Seller Portal', 'https://gem.gov.in', 'GEM-SELL-2231', 'Priya Sharma', 4, 'high', 2, 'no', false, 495],
  ['license', 'Microsoft 365 Admin', 'Licence · 120 seats', 'admin@inorbvict.com', 'Arjun Mehta', 1, 'high', 4, 'yes', false, 520],
  ['totp', 'Cloudflare 2FA Seed', 'Cloudflare', 'it@inorbvict.com', 'Arjun Mehta', 1, 'high', 4, 'na', false, 548],
  ['login', 'Office CCTV NVR', 'http://10.0.0.20', 'admin', 'Rahul Gupta', 8, 'medium', 1, 'no', false, 571],
  ['login', 'Electricity Board Portal', 'https://wss.mahadiscom.in', '170019xxxxxx', 'Rahul Gupta', 8, 'low', 2, 'no', false, 600],
  ['login', 'Travel Desk · MakeMyTrip', 'https://mybiz.makemytrip.com', 'travel@inorbvict.com', 'Rahul Gupta', 8, 'medium', 3, 'no', true, 640],
];

const MINE: Seed[] = [
  ['email', 'Personal Gmail', 'Google', 'rajesh.h@gmail.com', ADMIN, 0, 'high', 4, 'yes', false, 3],
  ['login', 'LinkedIn', 'https://www.linkedin.com', 'rajesh.h@gmail.com', ADMIN, 0, 'medium', 3, 'yes', false, 30],
  ['card', 'HDFC Regalia Card', 'HDFC Bank', 'XXXX 4410', ADMIN, 0, 'critical', 0, 'na', false, 52],
  ['govid', 'PAN Card', 'Income Tax Dept.', 'ABCPH1234K', ADMIN, 0, 'critical', 0, 'na', false, 96],
  ['passport', 'Passport', 'Govt. of India', 'Z1234567', ADMIN, 0, 'critical', 0, 'na', false, 150],
  ['login', 'Zerodha Kite', 'https://kite.zerodha.com', 'RH4521', ADMIN, 0, 'critical', 4, 'yes', false, 200],
  ['login', 'Amazon', 'https://www.amazon.in', 'rajesh.h@gmail.com', ADMIN, 0, 'low', 2, 'no', false, 260],
  ['wifi', 'Home Wi-Fi', 'Airtel Xstream', 'RH-Home-5G', ADMIN, 0, 'low', 3, 'na', false, 330],
  ['driver', 'Driving Licence', 'RTO Pune', 'MH12 2019xxxxxxx', ADMIN, 0, 'medium', 0, 'na', false, 410],
  ['medical', 'Health Insurance', 'Star Health', 'Policy 22/1123', ADMIN, 0, 'medium', 0, 'na', false, 480],
  ['membership', 'Gym Membership', 'Cult.fit', 'CF-88213', ADMIN, 0, 'low', 2, 'no', false, 560],
  ['login', 'Netflix', 'https://www.netflix.com', 'rajesh.h@gmail.com', ADMIN, 0, 'low', 1, 'no', false, 700],
];

const NOW = Date.UTC(2026, 10, 1, 6, 36);
const iso = (hoursAgo: number) => new Date(NOW - hoursAgo * 3_600_000).toISOString();

function toRow([type, name, sub, username, owner, deptId, risk, strength, twofa, shared, hours]: Seed, i: number, scope: 'team' | 'personal'): CredentialRow {
  const [type_label, category_group] = TYPES[type];
  const dept = DEPTS.find(d => d.id === deptId);
  const via: Via = scope === 'personal' ? 'owner' : shared ? 'share' : 'team';
  return {
    id: (scope === 'team' ? 1000 : 2000) + i,
    code: `CRD-${String((scope === 'team' ? 2 : 60) + i).padStart(4, '0')}`,
    critical_code: null, type, type_label, category_group, name, url: sub, username, scope,
    owner: { id: 0, name: owner, initials: initials(owner), is_me: scope === 'personal' },
    department: dept ? { id: dept.id, name: dept.name } : null,
    risk, strength, strength_label: STRENGTH[strength], strength_pct: strength * 25, has_password: strength > 0, twofa,
    rotation_days: null, next_rotation_due: null, rotation_state: null,
    protected: false, lock_steps: [],
    access: { permission: 'full', via },
    can: { reveal: true, copy: true, edit: true, share: true, delete: true, remove: false, edit_protection: false },
    unlock: null, active_shares: 0,
    created_at: iso(hours + 24 * 30), updated_at: iso(hours),
  };
}

const TEAM_ROWS = TEAM.map((s, i) => toRow(s, i, 'team'));
const MINE_ROWS = MINE.map((s, i) => toRow(s, i, 'personal'));

/* ── The four calls ───────────────────────────────────────────────────────── */

type ListQuery = Parameters<typeof cvApi.list>[0];
type ListResult = ListResponse<CredentialRow> & { member: Loose | null };

/** A short pause, so loading states still show in the design build. */
const later = <T>(value: T) => new Promise<T>(r => setTimeout(() => r(value), 250));

const dummy = {
  departments: () => later<Loose>({
    admin: {
      admins: [{ id: 0, name: ADMIN, initials: initials(ADMIN), role: 'Vault Administrator' }],
      members: allMembers().length + 1,
      departments: DEPTS.length,
      hods: DEPTS.length,
    },
    departments: DEPTS.map(d => ({
      id: d.id, name: d.name, hod: { name: d.hod }, members: d.lv.reduce((a, b) => a + b, 0), levels: levelList(d.lv),
    })),
  }),

  department: (id: number) => {
    const members = MEMBERS.get(id) ?? [];
    return later<Loose>({ members, stats: { teams: members.filter(m => m.level === 'tl').length } });
  },

  organisation: () => later<Loose>({ members: allMembers(), stats: { departments: DEPTS.length, hods: DEPTS.length } }),

  list: (q: ListQuery): Promise<ListResult> => {
    const { tab, q: text, page = 1, per_page = 10, department_id, member_employee_id } = q as Loose;
    const inDept = (r: CredentialRow) => !department_id || r.department?.id === department_id;
    const team = TEAM_ROWS.filter(inDept);
    let rows = tab === 'mine' ? MINE_ROWS : team;

    // A person sees their own department's credentials, less a few they were not given.
    if (tab === 'team' && member_employee_id) {
      rows = rows.filter(r => r.department?.id === deptOfEmployee(member_employee_id) && (r.id + member_employee_id) % 3 !== 0);
    }
    const t = String(text ?? '').toLowerCase();
    if (t) rows = rows.filter(r => [r.code, r.name, r.type_label, r.username, r.owner.name].some(v => String(v ?? '').toLowerCase().includes(t)));

    const last_page = Math.max(1, Math.ceil(rows.length / per_page));
    const current_page = Math.min(Math.max(1, Number(page)), last_page);
    return later<ListResult>({
      status: true,
      data: rows.slice((current_page - 1) * per_page, current_page * per_page),
      tabs: { mine: MINE_ROWS.length, team: team.length },
      meta: { current_page, per_page, total: rows.length, last_page },
      member: null,
    });
  },
};

const live = {
  departments: () => cvApi.departments(),
  department: (id: number) => cvApi.department(id),
  organisation: () => cvApi.organisation(),
  list: (q: ListQuery) => cvApi.list(q),
};

export const tvData = TV_DUMMY ? dummy : live;
