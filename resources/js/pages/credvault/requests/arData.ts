import { cvApi, type AccessRequestRow, type ListResponse } from '../cvApi';
import { initials } from '../shared';
import { later } from '../team-vault/tvData';

/**
 * Access Request Management's data source: the live CredVault API (/critical-vault/access-requests
 * and its approve / reject / cancel / lock calls). The prototype's 22 requests below answer the same
 * calls in the same shapes; set AR_DUMMY to true to design against them without a backend. In dummy
 * mode Approve, Reject, Cancel and Lock move a request on in memory (Vault Admin → Reporting Manager →
 * approved), so the whole flow can be walked through; a reload starts again.
 */
export const AR_DUMMY = false;

type Chip = { id: number; name: string; initials: string };
const chip = (id: number, name: string): Chip => ({ id, name, initials: initials(name) });
const ADMINS = { SK: chip(1, 'Sanjay Kulkarni'), MI: chip(2, 'Meera Iyer') };
const MGRS: Record<string, Chip> = {
  RV: chip(11, 'Rohan Verma'), AM: chip(12, 'Arjun Mehta'), AN: chip(13, 'Arvind Nair'), VR: chip(14, 'Varun Reddy'),
  KR: chip(15, 'Kavita Rao'), CR: chip(16, 'Chetan Raut'), PS: chip(17, 'Priya Sharma'),
};

/* [code, credential, CCRD, type key, type label, requester, role, dept, reason, minutes, admin, manager, state, hours ago]
   state: a = waiting for the Vault Admin, m = waiting for the Manager, ok = both approved,
          ra = rejected by the Vault Admin, rm = rejected by the Manager */
type Seed = [string, string, string, string, string, string, string, string, string, number, 'SK' | 'MI', string, 'a' | 'm' | 'ok' | 'ra' | 'rm', number];
const SEEDS: Seed[] = [
  ['REQ-4100', 'GST Portal', 'CCRD-001', 'login', 'Password', 'Ruchi Gupta', 'Team Lead', 'Accounts', 'Month-end bank reconciliation', 5, 'SK', 'RV', 'a', 0.4],
  ['REQ-4137', 'Corporate Amex', 'CCRD-004', 'card', 'Credit Card', 'Neha Joshi', 'Developer', 'IT', 'File GST return before the due date', 15, 'MI', 'RV', 'm', 0.9],
  ['REQ-4174', 'ICICI Current A/c', 'CCRD-006', 'bank', 'Bank Account', 'Vikram Singh', 'Network Engineer', 'IT', 'Vendor payment release for approved invoices', 30, 'SK', 'AM', 'a', 1.6],
  ['REQ-4211', 'CEO Mailbox', 'CCRD-002', 'email', 'Email', 'Suresh Yadav', 'Team Lead', 'IT', 'Renew digital signature with the CA', 60, 'MI', 'AM', 'm', 2.3],
  ['REQ-4248', 'Treasury Cold Wallet', 'CCRD-008', 'api', 'Crypto Wallet', 'Komal Gaikwad', 'Talent Acquisition Executive', 'HR', 'Production incident — need to rotate keys', 15, 'SK', 'RV', 'a', 3.0],
  ['REQ-4285', 'HDFC Salary Account', 'CCRD-010', 'bank', 'Bank Account', 'Sneha Kulkarni', 'Software Executive', 'IT', 'Update payroll bank details for new joiners', 30, 'MI', 'RV', 'm', 3.7],
  ['REQ-4322', 'AWS Root Account', 'CCRD-003', 'totp', 'TOTP / 2FA Seed', 'Amit Patil', 'IT Intern', 'IT', 'Rotate the root access keys after the audit', 15, 'SK', 'AM', 'a', 4.4],
  ['REQ-4359', 'Payroll Database', 'CCRD-026', 'database', 'Database', 'Aarti Mishra', 'HR Associate', 'HR', 'Download Form 16 for employees', 30, 'MI', 'PS', 'm', 5.1],
  ['REQ-4396', 'HDFC Travel Card', 'CCRD-005', 'card', 'Credit Card', 'Ruchi Gupta', 'Team Lead', 'Accounts', 'Quarterly TDS return filing', 30, 'SK', 'AN', 'ok', 9.0],
  ['REQ-4433', 'SBI Escrow Account', 'CCRD-007', 'bank', 'Bank Account', 'Isha Agarwal', 'HR Associate', 'HR', 'Audit evidence for statutory auditor', 60, 'MI', 'VR', 'ok', 14.0],
  ['REQ-4470', 'Company PAN', 'CCRD-009', 'govid', 'SSN / Aadhaar / PAN', 'Suresh Yadav', 'Team Lead', 'IT', 'Treasury transfer approved by CFO', 15, 'SK', 'AM', 'ok', 20.0],
  ['REQ-4507', 'Axis Bank Payroll Account', 'CCRD-011', 'bank', 'Bank Account', 'Vikram Singh', 'Network Engineer', 'IT', 'Reset admin password after lockout', 30, 'MI', 'KR', 'ok', 26.0],
  ['REQ-4544', 'Income Tax e-Filing Portal', 'CCRD-013', 'login', 'Login', 'Tanvi Shah', 'Dispatch Executive', 'Logistics', 'Month-end bank reconciliation', 5, 'SK', 'CR', 'ok', 31.0],
  ['REQ-4581', 'MCA21 Company Portal', 'CCRD-014', 'login', 'Login', 'Neha Joshi', 'Developer', 'IT', 'File GST return before the due date', 15, 'MI', 'RV', 'ok', 36.0],
  ['REQ-4618', 'TDS TRACES Portal', 'CCRD-025', 'login', 'Login', 'Ruchi Gupta', 'Team Lead', 'Accounts', 'Download the quarterly TDS certificates', 30, 'SK', 'AN', 'ok', 42.0],
  ['REQ-4625', 'Kotak Vendor Payments A/c', 'CCRD-024', 'bank', 'Bank Account', 'Divya Iyer', 'Purchase Executive', 'Purchase', 'Release the approved vendor payments', 15, 'MI', 'PS', 'ok', 48.0],
  ['REQ-4655', 'Digital Signature Certificate (DSC)', 'CCRD-016', 'govid', 'SSN / Aadhaar / PAN', 'Amit Patil', 'IT Intern', 'IT', 'Renew digital signature with the CA', 60, 'MI', 'RV', 'ra', 12.0],
  ['REQ-4692', 'Domain Registrar (GoDaddy)', 'CCRD-017', 'login', 'Login', 'Sneha Kulkarni', 'Software Executive', 'IT', 'Production incident — need to rotate keys', 15, 'SK', 'RV', 'rm', 18.0],
  ['REQ-4729', 'Azure Global Admin', 'CCRD-018', 'totp', 'TOTP / 2FA Seed', 'Komal Gaikwad', 'Talent Acquisition Executive', 'HR', 'Update payroll bank details for new joiners', 30, 'MI', 'AM', 'ra', 29.0],
  ['REQ-4766', 'Google Workspace Super Admin', 'CCRD-019', 'email', 'Email', 'Divya Iyer', 'Purchase Executive', 'Purchase', 'Download Form 16 for employees', 5, 'SK', 'PS', 'rm', 40.0],
  ['REQ-4803', 'Treasury Hot Wallet', 'CCRD-020', 'api', 'Crypto Wallet', 'Pallavi Bhosale', 'Accounts Executive', 'Accounts', 'Customs shipment clearance on ICEGATE', 15, 'MI', 'RV', 'ra', 52.0],
  ['REQ-4840', 'HDFC Corporate Credit Card', 'CCRD-021', 'card', 'Credit Card', 'Isha Agarwal', 'HR Associate', 'HR', 'Book flights for the client visit', 30, 'SK', 'VR', 'rm', 60.0],
];

/** Each request's progress, kept in memory so the buttons move it on. */
interface Flow { state: Seed[12]; at: number; adminAt: number; managerAt: number; cancelled: boolean; openedAt: number }
const FLOWS = new Map<number, Flow>();
const H = 3_600_000;
SEEDS.forEach((s, i) => {
  const at = Date.now() - s[13] * H;
  FLOWS.set(i + 1, { state: s[12], at, adminAt: at + 0.5 * H, managerAt: at + 1.2 * H, cancelled: false, openedAt: 0 });
});
const iso = (ms: number) => new Date(ms).toISOString();
/** The spec's default reason for a rejection; the requester sees it on the rejected stage. */
const REJECT_NOTE = 'Not approved at this time';

function rowOf(id: number): AccessRequestRow {
  const s = SEEDS[id - 1], f = FLOWS.get(id)!;
  const [code, name, ccrd, type, typeLabel, who, role, dept, reason, mins, admKey, mgrKey] = s;
  const adm = ADMINS[admKey], mgr = MGRS[mgrKey];
  const st = f.state;
  const adminDone = st !== 'a' && st !== 'ra';
  const mgrDone = st === 'ok' || st === 'rm';
  const rejected = st === 'ra' || st === 'rm';
  const pending = st === 'a' || st === 'm';
  const left = f.openedAt ? Math.max(0, Math.round(mins * 60 - (Date.now() - f.openedAt) / 1000)) : 0;
  const label = st === 'a' ? 'Step 1 of 2 · Vault Admin' : st === 'm' ? 'Step 2 of 2 · Manager'
    : st === 'ok' ? 'Both approvals done' : st === 'ra' ? 'Rejected by Vault Admin' : 'Rejected by Manager';
  return {
    id, code,
    credential: { id, code: ccrd, critical_code: ccrd, name, type, type_label: typeLabel, category_group: '', risk: 'critical', url: null, in_bin: false },
    requester: { id: 100 + id, name: who, initials: initials(who), designation: role, department: dept, role_line: `${role} · ${dept}`, is_me: false },
    reason, duration_minutes: mins, duration_label: mins >= 60 ? `${mins / 60} hour` : `${mins} min`,
    admin: {
      user: adm, any_admin: false,
      status: st === 'ra' ? 'rejected' : adminDone ? 'approved' : 'pending',
      decided_at: st === 'a' ? null : iso(f.adminAt), decided_by: st === 'a' ? null : adm, note: st === 'ra' ? REJECT_NOTE : null,
    },
    manager: {
      user: st === 'a' || st === 'ra' ? null : mgr,
      status: st === 'ra' ? 'not_required' : st === 'a' ? 'after_admin' : st === 'rm' ? 'rejected' : mgrDone ? 'approved' : 'pending',
      decided_at: mgrDone ? iso(f.managerAt) : null, decided_by: mgrDone ? mgr : null, note: st === 'rm' ? REJECT_NOTE : null,
    },
    otp: null,
    status: rejected ? 'rejected' : pending ? 'pending' : left > 0 ? 'unlocked' : 'approved',
    display_status: rejected ? 'rejected' : pending ? 'pending' : 'approved',
    status_label: label, stage: st === 'a' ? 'admin' : st === 'm' ? 'manager' : null,
    stage_label: st === 'a' ? 'Vault Admin' : st === 'm' ? 'Reporting Manager' : null,
    steps: ['admin', 'manager'],
    step: st === 'a' ? { number: 1, of: 2, label: 'Vault Admin' } : st === 'm' ? { number: 2, of: 2, label: 'Reporting Manager' } : null,
    unlocked_at: f.openedAt ? iso(f.openedAt) : null, expires_at: f.openedAt ? iso(f.openedAt + mins * 60_000) : null,
    seconds_left: left, total_seconds: mins * 60, locked_reason: null,
    // The prototype's view is the Vault Admin's: every waiting request can be approved or rejected.
    can: { approve: pending, reject: pending, cancel: false, verify_otp: false, lock: left > 0 },
    created_at: iso(f.at),
  };
}

const visible = () => SEEDS.map((_, i) => i + 1).filter(id => !FLOWS.get(id)!.cancelled).map(rowOf);

type Query = Parameters<typeof cvApi.requests>[0];

const dummy = {
  requests: (q: Query): Promise<ListResponse<AccessRequestRow>> => {
    const { tab = 'all', q: text, page = 1, per_page = 10 } = (q ?? {}) as Record<string, string | number | undefined>;
    const all = visible().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const by = { all, pending: all.filter(r => r.display_status === 'pending'), approved: all.filter(r => r.display_status === 'approved'), rejected: all.filter(r => r.display_status === 'rejected') };
    let rows = by[tab as keyof typeof by] ?? all;
    const t = String(text ?? '').trim().toLowerCase();
    // As the spec: request ID, credential, requester, department, reason and the approvers' names.
    if (t) rows = rows.filter(r => [r.code, r.credential?.name, r.credential?.code, r.requester.name, r.requester.department, r.reason, r.admin?.user?.name, r.manager?.user?.name, r.duration_label]
      .some(v => String(v ?? '').toLowerCase().includes(t)));
    const per = Number(per_page) || 10;
    const last_page = Math.max(1, Math.ceil(rows.length / per));
    const current_page = Math.min(Math.max(1, Number(page) || 1), last_page);
    return later({
      status: true as const,
      data: rows.slice((current_page - 1) * per, current_page * per),
      tabs: { all: by.all.length, pending: by.pending.length, approved: by.approved.length, rejected: by.rejected.length },
      meta: { current_page, per_page: per, total: rows.length, last_page },
    });
  },

  /** The Vault Admin's approval sends it on to the Reporting Manager; the Manager's completes it. */
  approve: (id: number) => {
    const f = FLOWS.get(id)!;
    if (f.state === 'a') { f.state = 'm'; f.adminAt = Date.now(); }
    else if (f.state === 'm') { f.state = 'ok'; f.managerAt = Date.now(); }
    return later({ data: rowOf(id), message: f.state === 'm' ? 'Sent to the Reporting Manager for the second approval.' : 'Both approvals are in — the credential can now be unlocked.' });
  },
  reject: (id: number) => {
    const f = FLOWS.get(id)!;
    if (f.state === 'a') { f.state = 'ra'; f.adminAt = Date.now(); }
    else if (f.state === 'm') { f.state = 'rm'; f.managerAt = Date.now(); }
    return later({ data: rowOf(id), message: 'The requester has been told.' });
  },
  cancel: (id: number) => { FLOWS.get(id)!.cancelled = true; return later({ data: rowOf(id), message: 'Request withdrawn.' }); },
  lock: (id: number) => { FLOWS.get(id)!.openedAt = 0; return later({ data: rowOf(id), message: 'Locked again.' }); },
};

const live = {
  requests: cvApi.requests,
  approve: (id: number) => cvApi.approve(id),
  reject: (id: number) => cvApi.reject(id),
  cancel: cvApi.cancel,
  lock: cvApi.lock,
};

export const arData = AR_DUMMY ? dummy : live;
