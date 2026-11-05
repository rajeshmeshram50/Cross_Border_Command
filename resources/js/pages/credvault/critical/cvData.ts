import { cvApi, type AccessRequestRow, type AuditEvent, type CredentialDetail, type CredentialRow, type DetailField, type ListResponse, type LockStep, type UnlockState } from '../cvApi';
import type { ViewSource } from '../my-vault/ViewDrawer';
import { initials } from '../shared';
import { ADMIN, later, toRow, type Seed } from '../team-vault/tvData';

/**
 * Critical Vault's data source: the live CredVault API (/credvault/credentials?risk=critical,
 * /credentials/{id}, the access-request calls). The prototype's critical rows below answer the
 * same calls in the same shapes; set CV_DUMMY to true to design against them without a backend.
 * In dummy mode each row keeps a small unlock state, so the whole flow can be walked through:
 * request → Vault Admin → Manager → authenticator → unlocked, with the prototype's "act as"
 * approve / reject standing in for the approvers (decide()). Rows are built with Team Vault's
 * dummy row builder, so only the critical parts (CCRD code, lock steps, access, rights) are set here.
 */
export const CV_DUMMY = true;

/* [type, name, sub line, username, owner, department id, risk, strength 0-4, 2FA, shared, hours since update]
   Department ids are Team Vault's: 1 IT, 3 HR, 5 Logistics, 7 Accounts; 0 = personal. */
const MINE: Seed[] = [
  ['bank', 'HDFC Salary Account', 'HDFC Bank', 'XXXX 7710', ADMIN, 7, 'critical', 3, 'yes', false, 34],
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
    // Locked rows reveal only through the unlock. Edit and bin are on for every row, as in the prototype
    // (the Vault Admin's view); live data takes them from the API's rights.
    can: { reveal: false, copy: false, edit: true, share: false, delete: true, remove: false, edit_protection: mine },
    unlock: null,
  };
}

const ROWS = [...MINE.map(s => critical(s, true)), ...TEAM.map(s => critical(s, false))];
const MINE_IDS = new Set(ROWS.filter(r => r.owner.is_me).map(r => r.id));

/* ── The dummy unlock flow ─────────────────────────────────────────────────── */

/** Where a row's unlock stands. manager_ready = the admin approved and the request to the manager is not sent yet. */
type Phase = 'locked' | 'admin' | 'manager_ready' | 'manager' | 'otp' | 'open';
interface Flow { phase: Phase; reason: string; minutes: number; sentAt: number; adminAt: number; managerAt: number; openedAt: number; rejected: 'admin' | 'manager' | null }

const ADMIN_BY = { id: 1, name: 'Sanjay Kulkarni', initials: 'SK' };
const MANAGER_BY = { id: 2, name: 'Priya Sharma', initials: 'PS' };
const MIN = 60_000;
const ago = (m: number) => Date.now() - m * MIN;

const FLOWS = new Map<number, Flow>();
const flowOf = (id: number): Flow => {
  if (!FLOWS.has(id)) FLOWS.set(id, { phase: 'locked', reason: '', minutes: 15, sentAt: 0, adminAt: 0, managerAt: 0, openedAt: 0, rejected: null });
  return FLOWS.get(id)!;
};
// One row in each state at first, so every Access Status shows in the list.
const seedFlow = (name: string, f: Partial<Flow>) => {
  const r = ROWS.find(x => x.name === name);
  if (r) Object.assign(flowOf(r.id), { reason: 'Need the portal login to complete the month-end payment', sentAt: ago(6), adminAt: ago(4), managerAt: ago(3), ...f });
};
seedFlow('Razorpay Settlement Dashboard', { phase: 'admin' });
seedFlow('Kotak Vendor Payments A/c', { phase: 'manager' });
seedFlow('ICICI Corporate Net Banking', { phase: 'otp' });
seedFlow('GST Portal', { phase: 'open', openedAt: Date.now() - (900 - 272) * 1000 });

/** The phase after a stage is cleared, from the row's own steps. */
function nextAfter(r: CredentialRow, done: LockStep | null): Phase {
  const rest = r.lock_steps.slice(done ? r.lock_steps.indexOf(done) + 1 : 0);
  if (!rest.length) return 'open';
  return rest[0] === 'admin' ? 'admin' : rest[0] === 'manager' ? (done ? 'manager_ready' : 'manager') : 'otp';
}

function unlockOf(r: CredentialRow): UnlockState {
  const f = flowOf(r.id);
  const of = r.lock_steps.length;
  const step = (k: LockStep) => ({ number: r.lock_steps.indexOf(k) + 1, of });
  if (f.phase === 'open') {
    const total = f.minutes * 60;
    const left = Math.round(total - (Date.now() - f.openedAt) / 1000);
    if (left > 0) return { state: 'open', label: 'Unlocked', request_id: r.id, seconds_left: left, total_seconds: total };
    f.phase = 'locked';   // the window ended: it locks again by itself
  }
  switch (f.phase) {
    case 'admin': return { state: 'pending', label: 'Waiting for Vault Admin', stage: 'admin', request_id: r.id, step: step('admin'), waiting_for: { role: 'Vault Admin', name: ADMIN_BY.name } };
    case 'manager': return { state: 'pending', label: 'Waiting for Manager', stage: 'manager', request_id: r.id, step: step('manager'), waiting_for: { role: 'Manager', name: MANAGER_BY.name } };
    case 'manager_ready': return { state: 'progress', label: 'Request manager approval', stage: 'manager', request_id: r.id, step: step('manager') };
    case 'otp': return { state: 'progress', label: 'Enter authenticator code', stage: 'otp', request_id: r.id, step: step('otp') };
    default: return { state: 'locked', label: 'Approval needed' };
  }
}

const iso = (ms: number) => (ms ? new Date(ms).toISOString() : null);

/** The open request behind a row, in the API's shape; the last rejected one while locked; else null. */
function requestOf(r: CredentialRow): AccessRequestRow | null {
  const f = flowOf(r.id);
  const u = unlockOf(r);
  if (f.phase === 'locked' && !f.rejected) return null;
  const at = (p: Phase[]) => p.includes(f.phase);
  const adminDone = at(['manager_ready', 'manager', 'otp', 'open']) || (r.lock_steps[0] !== 'admin' && f.phase !== 'locked');
  const managerDone = at(['otp', 'open']) || (!r.lock_steps.includes('manager') && adminDone);
  const open = f.phase === 'open';
  const rejected = f.phase === 'locked' && f.rejected;
  return {
    id: r.id, code: `REQ-${7300 + (r.id % 100)}`,
    credential: { id: r.id, code: r.code, critical_code: r.critical_code, name: r.name, type: r.type, type_label: r.type_label, category_group: r.category_group, risk: r.risk, url: r.url, in_bin: false },
    requester: { id: 0, name: ADMIN, initials: initials(ADMIN), designation: 'Vault Administrator', department: null, role_line: null, is_me: true },
    reason: f.reason || null, duration_minutes: f.minutes, duration_label: `${f.minutes} min`,
    admin: r.lock_steps.includes('admin') ? {
      user: ADMIN_BY, any_admin: false, decided_by: adminDone || f.rejected === 'admin' ? ADMIN_BY : null,
      status: f.rejected === 'admin' ? 'rejected' : adminDone ? 'approved' : 'pending', decided_at: adminDone || f.rejected === 'admin' ? iso(f.adminAt) : null,
      note: f.rejected === 'admin' ? 'Not approved at this time' : null,
    } : null,
    manager: r.lock_steps.includes('manager') ? {
      user: MANAGER_BY, decided_by: managerDone || f.rejected === 'manager' ? MANAGER_BY : null,
      status: f.rejected === 'manager' ? 'rejected' : managerDone ? 'approved' : f.phase === 'manager' ? 'pending' : 'waiting',
      decided_at: managerDone || f.rejected === 'manager' ? iso(f.managerAt) : null,
      note: f.rejected === 'manager' ? 'Not approved at this time' : null,
    } : null,
    otp: r.lock_steps.includes('otp') ? { verified_at: open ? iso(f.openedAt) : null, attempts_left: 3 } : null,
    status: rejected ? 'rejected' : open ? 'unlocked' : managerDone ? 'approved' : 'pending',
    display_status: rejected ? 'rejected' : open || managerDone ? 'approved' : 'pending',
    status_label: u.label, stage: u.stage ?? null, stage_label: u.label, steps: r.lock_steps,
    step: u.step ? { ...u.step, label: u.label } : null,
    unlocked_at: open ? iso(f.openedAt) : null, expires_at: open ? iso(f.openedAt + f.minutes * MIN) : null,
    seconds_left: u.seconds_left ?? 0, total_seconds: u.total_seconds ?? 0, locked_reason: null,
    can: { approve: false, reject: false, cancel: !open && !rejected, verify_otp: f.phase === 'otp', lock: open },
    created_at: iso(f.sentAt),
  };
}

/** What a row's type shows once unlocked: its address, username and the masked secret. */
const SECRETS: Record<string, string> = { password: 'Inorb@Secure#2026', nbpass: 'Hdfc@NetBank#26', acno: '0012 3400 4521' };
function fieldsOf(r: CredentialRow): DetailField[] {
  const f = (key: string, label: string, value: string | null, masked = false): DetailField => ({ key, label, kind: masked ? 'secret' : 'text', value: masked ? null : value, masked, has_value: !!value });
  return r.type === 'bank'
    ? [f('bank', 'Bank Name', r.url), f('holder', 'Account Holder', 'Inorbvict Healthcare India Pvt. Ltd'), f('acno', 'Account Number', SECRETS.acno, true), f('nbpass', 'Net-Banking Password', SECRETS.nbpass, true)]
    : [f('url', 'Website / App', r.url), f('username', 'Username', r.username), f('password', 'Password', SECRETS.password, true)];
}

const rowOf = (id: number) => {
  const r = ROWS.find(x => x.id === id);
  if (!r) throw new Error('Credential not found.');
  return { ...r, unlock: unlockOf(r) };
};

function detailOf(id: number): CredentialDetail {
  const r = rowOf(id);
  // The owner opens their own credential directly (My Critical Credentials); anyone else after the unlock.
  const free = MINE_IDS.has(r.id) || r.unlock.state === 'open';
  return {
    ...r,
    can: r.can ? { ...r.can, reveal: free, copy: free } : r.can,
    locked: !free, updated_by: r.owner.name,
    fields: fieldsOf(r),
    unlock_plan: {
      steps: r.lock_steps.map((key, i) => ({
        step: i + 1, key, label: key === 'admin' ? 'Vault Admin' : key === 'manager' ? 'Manager' : 'Authenticator', ready: true,
        approver: key === 'admin' ? { ...ADMIN_BY, role: 'Vault Admin' } : key === 'manager' ? { ...MANAGER_BY, role: 'Manager' } : null,
      })),
      of: r.lock_steps.length, durations: [5, 15, 30, 60], asks_reason: true, default_minutes: 15,
    },
    last_request: requestOf(r),
  };
}

/** The one-time authenticator setup: the requester links their app once, then every unlock uses it. */
export interface OtpSetup { secret_display: string; otpauth_uri: string }
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
let setupSecret = '';
let appLinked = false;

/** The dummy answer to a request call: the request as it now stands. */
const answer = (id: number, message: string) => later({ data: requestOf(rowOf(id))!, message });

type ListQuery = Parameters<typeof cvApi.list>[0];

const dummy = {
  list: (q: ListQuery): Promise<ListResponse<CredentialRow>> => {
    const { tab = 'all', q: text, page = 1 } = q ?? {};
    const per_page = Number(q?.per_page) || 10;
    const all = ROWS.map(r => rowOf(r.id)).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    const mine = all.filter(r => MINE_IDS.has(r.id));
    const team = all.filter(r => !MINE_IDS.has(r.id));
    let rows = tab === 'mine' ? mine : tab === 'others' ? team : all;
    const t = String(text ?? '').toLowerCase();
    if (t) rows = rows.filter(r => [r.critical_code, r.name, r.type_label, r.category_group, r.username, r.owner.name].some(v => String(v ?? '').toLowerCase().includes(t)));

    const last_page = Math.max(1, Math.ceil(rows.length / per_page));
    const current_page = Math.min(Math.max(1, Number(page)), last_page);
    return later({
      status: true,
      data: rows.slice((current_page - 1) * per_page, current_page * per_page),
      tabs: { all: all.length, mine: mine.length, others: team.length },
      meta: { current_page, per_page, total: rows.length, last_page },
    });
  },

  show: (id: number): Promise<CredentialDetail> => later(detailOf(id)),

  /** Send request: the first stage, or the manager once the admin has approved. */
  requestAccess: (credId: number, body: { reason?: string; duration_minutes?: number }) => {
    const r = rowOf(credId), f = flowOf(credId);
    if (f.phase === 'manager_ready') f.phase = 'manager';
    else {
      Object.assign(f, { reason: body.reason ?? '', minutes: body.duration_minutes ?? 15, sentAt: Date.now(), rejected: null });
      f.phase = nextAfter(r, null);
      if (f.phase === 'open') f.openedAt = Date.now();
    }
    return answer(credId, 'Request sent');
  },

  /** The requester forwards an admin-approved request to the manager (dummy: open the manager stage). */
  raiseManager: (reqId: number) => { const f = flowOf(reqId); if (f.phase === 'manager_ready') f.phase = 'manager'; return answer(reqId, 'Forwarded to the reporting manager.'); },

  /** The prototype's "act as": the waiting approver approves or rejects. */
  decide: (reqId: number, approve: boolean) => {
    const r = rowOf(reqId), f = flowOf(reqId);
    const stage: LockStep = f.phase === 'manager' ? 'manager' : 'admin';
    if (!approve) { Object.assign(f, { phase: 'locked', rejected: stage }); return answer(reqId, 'Rejected'); }
    if (stage === 'admin') f.adminAt = Date.now(); else f.managerAt = Date.now();
    f.phase = nextAfter(r, stage);
    if (f.phase === 'open') f.openedAt = Date.now();
    return answer(reqId, 'Approved');
  },

  cancel: (reqId: number) => { Object.assign(flowOf(reqId), { phase: 'locked', rejected: null }); return later({ data: null, message: 'Cancelled' }); },

  /** The QR and setup key until the first code is verified; null once the app is linked. */
  otpSetup: (_credId: number): Promise<OtpSetup | null> => {
    if (appLinked) return later(null);
    if (!setupSecret) setupSecret = Array.from({ length: 20 }, () => B32[Math.floor(Math.random() * 32)]).join('');
    return later({
      secret_display: setupSecret.match(/.{4}/g)!.join(' '),
      otpauth_uri: `otpauth://totp/CredVault:${encodeURIComponent(ADMIN)}?secret=${setupSecret}&issuer=CredVault`,
    });
  },

  sendOtp: (_reqId: number) => later({ data: { sent_to: 'in•••s@gmail.com', expires_in: 300, resend_in: 30 }, message: 'Code sent' }),

  /** Any 6 digits open it in dummy mode. */
  verifyOtp: (reqId: number, _code: string) => {
    appLinked = true;
    Object.assign(flowOf(reqId), { phase: 'open', openedAt: Date.now() });
    return answer(reqId, 'Unlocked');
  },

  lock: (reqId: number) => { Object.assign(flowOf(reqId), { phase: 'locked', rejected: null }); return later({ data: null, message: 'Locked' }); },

  reveal: (id: number, _action: 'reveal' | 'copy', field?: string) => {
    const k = field ?? 'password';
    return later({ field: k, label: fieldsOf(rowOf(id)).find(x => x.key === k)?.label ?? 'Password', value: SECRETS[k] ?? '', hide_after_seconds: 20, clear_clipboard_after: 30 });
  },

  event: (_id: number, _action: 'view' | 'launch' | 'copy', _field?: string) => later(null),
};

const live = {
  list: (q: ListQuery) => cvApi.list(q),
  show: (id: number) => cvApi.show(id),
  requestAccess: cvApi.requestAccess,
  /** The requester forwards an admin-approved request to their reporting manager. */
  raiseManager: cvApi.raiseManager,
  /** Only the dummy data has the prototype's "act as": real approvals come from Access Request Management. */
  decide: undefined as typeof dummy.decide | undefined,
  cancel: cvApi.cancel,
  /** The API links the authenticator per credential (owner, in the form) — no per-user setup yet. */
  otpSetup: (_credId: number): Promise<OtpSetup | null> => Promise.resolve(null),
  sendOtp: cvApi.sendOtp,
  verifyOtp: cvApi.verifyOtp,
  lock: cvApi.lock,
  reveal: cvApi.reveal,
  event: cvApi.event,
};

export const cvData = CV_DUMMY ? dummy : live;

/** The View drawer's calls on the dummy rows: the details, a short activity timeline, reveal / copy. */
function activityOf(id: number): AuditEvent[] {
  const r = rowOf(id);
  const ev = (n: number, action: string, label: string, verb: string, hours: number): AuditEvent => ({
    id: r.id * 10 + n, event_id: `EVT-${r.id}${n}`, at: new Date(Date.now() - hours * 3_600_000).toISOString(),
    actor: { id: 0, name: r.owner.name ?? ADMIN, full_name: r.owner.name ?? ADMIN, initials: initials(r.owner.name ?? ADMIN), role: 'Owner', is_me: r.owner.is_me },
    action, label, verb, severity: 'info', severity_label: 'Info',
    credential: { id: r.id, code: r.critical_code, name: r.name, risk: r.risk, type: r.type },
    target: r.name, module: 'Critical Vault', detail: null, ip: '10.0.4.21',
  });
  return [ev(3, 'view', 'Viewed', 'viewed', 2), ev(2, 'update', 'Updated', 'updated', 30), ev(1, 'create', 'Created', 'created', 240)];
}
const viewDummy: ViewSource = {
  show: dummy.show,
  activity: (id: number) => later({ data: activityOf(id), meta: { current_page: 1, per_page: 20, total: 3, last_page: 1 } }),
  reveal: dummy.reveal,
  event: dummy.event,
  attachment: () => later(undefined),
} as unknown as ViewSource;
export const viewSource: ViewSource = CV_DUMMY ? viewDummy : cvApi;
