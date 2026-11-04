import { cvApi, type CredentialRow, type ListResponse, type LockStep, type UnlockState } from '../cvApi';
import { ADMIN, later, toRow, type Seed } from '../team-vault/tvData';

/**
 * Critical Vault's data source: the live CredVault API (/credvault/credentials?risk=critical).
 * The prototype's critical rows below answer the same call in the same shape;
 * set CV_DUMMY to true to design against them without a backend. Rows are
 * built with Team Vault's dummy row builder, so only the critical parts
 * (CCRD code, lock steps, access state, rights) are set here.
 */
export const CV_DUMMY = true;

/* [type, name, sub line, username, owner, department id, risk, strength 0-4, 2FA, shared, hours since update]
   Department ids are Team Vault's: 1 IT, 3 HR, 5 Logistics, 7 Accounts; 0 = personal. */
const MINE: Seed[] = [
  ['bank', 'HDFC Salary Account', 'HDFC Bank', 'XXXX 7710', ADMIN, 7, 'critical', 3, 'no', false, 34],
  ['bank', 'Axis Bank Payroll Account', 'Axis Bank', 'XXXX 3302', ADMIN, 7, 'critical', 4, 'yes', false, 57],
  ['login', 'ICICI Corporate Net Banking', 'https://cib.icicibank.com', 'INORB.ADMIN', ADMIN, 7, 'critical', 3, 'yes', false, 80],
  ['login', 'GST Portal', 'https://gst.gov.in', 'INORB27AAACR', ADMIN, 7, 'critical', 4, 'yes', false, 89],
  ['login', 'Income Tax e-Filing Portal', 'https://eportal.incometax.gov.in', 'AAACI1234K', ADMIN, 7, 'critical', 4, 'no', false, 103],
  ['login', 'MCA21 Company Portal', 'https://www.mca.gov.in', 'DIR-RKUMAR', ADMIN, 0, 'critical', 3, 'yes', false, 126],
];

const TEAM: Seed[] = [
  ['login', 'Razorpay Settlement Dashboard', 'https://dashboard.razorpay.com', 'accounts@inorbvict.com', 'Arvind Nair', 7, 'critical', 4, 'no', false, 103],
  ['bank', 'Kotak Vendor Payments A/c', 'Kotak Mahindra Bank', 'XXXX 5518', 'Ruchi Gupta', 7, 'critical', 3, 'yes', false, 126],
  ['login', 'TDS TRACES Portal', 'https://www.tdscpc.gov.in', 'PNEI01234B', 'Ruchi Gupta', 7, 'critical', 4, 'yes', false, 149],
  ['totp', 'AWS Root Account', 'AWS Console', 'root@inorbvict.com', 'Arjun Mehta', 1, 'critical', 0, 'na', false, 165],
  ['database', 'Payroll Database', 'payroll-db.internal.inorbvict.com', 'payroll_admin', 'Aarti Mishra', 3, 'critical', 3, 'no', false, 172],
  ['login', 'ESIC Employer Portal', 'https://www.esic.gov.in', '31000123450001001', 'Varun Reddy', 3, 'critical', 4, 'yes', false, 195],
  ['login', 'ICEGATE e-Filing', 'https://www.icegate.gov.in', 'inorbvict_cha', 'Chetan Raut', 5, 'critical', 3, 'no', false, 220],
  ['card', 'Corporate Amex Card', 'American Express', 'XXXX 1009', 'Arvind Nair', 7, 'critical', 0, 'na', false, 250],
];

const LOCKED: UnlockState = { state: 'locked', label: 'Approval needed' };

/** One of each access state, so every Access Status design shows; the rest are locked. */
const STATES: Record<string, UnlockState> = {
  'Razorpay Settlement Dashboard': { state: 'pending', label: 'Waiting for Vault Admin', stage: 'admin', step: { number: 1, of: 2 }, waiting_for: { role: 'Vault Admin', name: 'Sanjay Kulkarni' } },
  'Kotak Vendor Payments A/c': { state: 'pending', label: 'Waiting for Manager', stage: 'manager', step: { number: 2, of: 3 }, waiting_for: { role: 'Manager', name: 'Priya Sharma' } },
  'ICICI Corporate Net Banking': { state: 'progress', label: 'Enter authenticator code', stage: 'otp', step: { number: 3, of: 3 } },
  'GST Portal': { state: 'open', label: 'Unlocked', seconds_left: 272, total_seconds: 900 },
};

let seq = 9;
function critical(seed: Seed, mine: boolean): CredentialRow {
  const base = toRow(seed, 0, seed[5] ? 'team' : 'personal');
  const n = ++seq;
  const code = `CRD-${String(n).padStart(4, '0')}`;
  const steps: LockStep[] = ['admin', 'manager', ...(seed[8] === 'yes' ? ['otp' as const] : [])];
  return {
    ...base,
    id: 3000 + n, code, critical_code: `C${code}`,
    owner: { ...base.owner, is_me: mine },
    protected: true, lock_steps: steps,
    access: mine ? { permission: 'full', via: 'owner' } : { permission: 'copy', via: 'team' },
    // Locked rows reveal only through the unlock; only the owner edits or bins.
    can: { reveal: false, copy: false, edit: mine, share: false, delete: mine, remove: false, edit_protection: mine },
    unlock: STATES[seed[1]] ?? LOCKED,
  };
}

const MINE_ROWS = MINE.map(s => critical(s, true));
const TEAM_ROWS = TEAM.map(s => critical(s, false));

type ListQuery = Parameters<typeof cvApi.list>[0];

const dummy = {
  list: (q: ListQuery): Promise<ListResponse<CredentialRow>> => {
    const { tab = 'all', q: text, page = 1 } = q ?? {};
    const per_page = Number(q?.per_page) || 10;
    const all = [...MINE_ROWS, ...TEAM_ROWS].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    let rows = tab === 'mine' ? MINE_ROWS : tab === 'others' ? TEAM_ROWS : all;
    const t = String(text ?? '').toLowerCase();
    if (t) rows = rows.filter(r => [r.critical_code, r.name, r.type_label, r.category_group, r.username, r.owner.name].some(v => String(v ?? '').toLowerCase().includes(t)));

    const last_page = Math.max(1, Math.ceil(rows.length / per_page));
    const current_page = Math.min(Math.max(1, Number(page)), last_page);
    return later({
      status: true,
      data: rows.slice((current_page - 1) * per_page, current_page * per_page),
      tabs: { all: all.length, mine: MINE_ROWS.length, others: TEAM_ROWS.length },
      meta: { current_page, per_page, total: rows.length, last_page },
    });
  },
};

const live = {
  list: (q: ListQuery) => cvApi.list(q),
};

export const cvData = CV_DUMMY ? dummy : live;
