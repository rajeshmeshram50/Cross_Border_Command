import axios from 'axios';
import api from '../../api';

/* ─────────────────────────────────────────────────────────────────────────
 * CredVault API client — one typed function per endpoint of
 * /api/credvault (CredVaultController). docs/CREDVAULT_API_SHEET.md is the
 * contract: every screen of the prototype maps to the calls below.
 *
 * Refusals come back as { status:false, message, errors? }; CvApiError keeps
 * both so a form can put each message on its own field.
 * ───────────────────────────────────────────────────────────────────────── */

export class CvApiError extends Error {
  status: number;
  errors: Record<string, string[]>;
  code?: string;
  data?: unknown;
  constructor(message: string, status = 0, errors: Record<string, string[]> = {}, code?: string, data?: unknown) {
    super(message);
    this.status = status;
    this.errors = errors;
    this.code = code;
    this.data = data;
  }
  /** The first message for a field, for the input under it. */
  field(name: string): string | undefined {
    return this.errors[name]?.[0];
  }
}

function toError(e: unknown): CvApiError {
  if (axios.isAxiosError(e)) {
    const d = e.response?.data as { message?: string; errors?: Record<string, string[]>; code?: string; data?: unknown } | undefined;
    return new CvApiError(d?.message || e.message || 'Something went wrong.', e.response?.status ?? 0, d?.errors ?? {}, d?.code, d?.data);
  }
  return new CvApiError(e instanceof Error ? e.message : 'Something went wrong.');
}

type Q = Record<string, string | number | boolean | null | undefined>;
/** The viewer's IANA timezone — day-based screens (dashboard, audit ranges) count in it, not in the server's UTC. */
const viewerTz = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;
const clean = (q?: Q) => Object.fromEntries(Object.entries(q ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== ''));

async function get<T>(path: string, params?: Q): Promise<T> {
  try { return (await api.get(`/credvault${path}`, { params: clean(params) })).data as T; } catch (e) { throw toError(e); }
}
async function send<T>(method: 'post' | 'put' | 'delete', path: string, body?: unknown): Promise<T> {
  try {
    const r = method === 'delete'
      ? await api.delete(`/credvault${path}`, { data: body })
      : await api[method](`/credvault${path}`, body);
    return r.data as T;
  } catch (e) { throw toError(e); }
}

/** A file from the API (export, backup, sample): saved to the user's device. */
export interface CvDownload { name: string; size: number; headers: Record<string, string> }
async function download(method: 'get' | 'post', path: string, body?: unknown, params?: Q): Promise<CvDownload> {
  try {
    const r = await api.request({ method, url: `/credvault${path}`, data: body, params: clean(params), responseType: 'blob' });
    const cd = String(r.headers['content-disposition'] ?? '');
    const name = /filename="?([^";]+)"?/.exec(cd)?.[1] ?? 'credvault-file';
    const blob = r.data as Blob;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    const headers: Record<string, string> = {};
    Object.entries(r.headers).forEach(([k, v]) => { headers[k.toLowerCase()] = String(v); });
    return { name, size: blob.size, headers };
  } catch (e) {
    // The body of a refused download is a JSON blob — read it back for the message.
    if (axios.isAxiosError(e) && e.response?.data instanceof Blob) {
      try {
        const d = JSON.parse(await e.response.data.text());
        throw new CvApiError(d.message ?? 'Download failed.', e.response.status, d.errors ?? {});
      } catch (inner) { if (inner instanceof CvApiError) throw inner; }
    }
    throw toError(e);
  }
}

/* ══════════════════════════════ TYPES ══════════════════════════════ */

export type Risk = 'low' | 'medium' | 'high' | 'critical';
export type Twofa = 'yes' | 'no' | 'na';
export type Perm = 'use' | 'view' | 'copy' | 'full';
export type Via = 'owner' | 'admin' | 'hod' | 'team' | 'share';
export type LockStep = 'admin' | 'manager' | 'otp';

export interface PageMeta { current_page: number; per_page: number; total: number; last_page: number }
export interface ListResponse<T, Tabs = Record<string, number>> { status: true; data: T[]; tabs: Tabs; meta: PageMeta }

export interface FieldDef {
  key: string; label: string; kind: 'text' | 'url' | 'email' | 'tel' | 'number' | 'date' | 'select' | 'textarea' | 'password' | 'secret' | 'file' | 'toggle';
  required: boolean; placeholder: string | null; options: string[] | null; icon: string | null;
  span: number; max: number | null; upper: boolean; mono: boolean; secret: boolean;
}
export interface TypeDef {
  key: string; label: string; icon: string; group: string; risk: Risk; twofa: boolean; id: string | null; sec: string | null;
  is_new: boolean; description: string; field_count: number;
  extras: { reg_email: boolean; reg_phone: boolean; recovery_key: boolean; attachments: boolean };
  fields: FieldDef[];
}
export interface Meta {
  types: TypeDef[];
  groups: { name: string; description: string; icon: string; types: string[] }[];
  risks: { key: Risk; label: string }[];
  rotations: { days: number | null; label: string }[];
  strengths: Record<number, string>;
  permissions: { key: Perm; label: string; description: string }[];
  share_durations: { days: number | null; label: string; critical_allowed: boolean }[];
  unlock_durations: number[];
  audit_actions: { key: string; label: string; severity: string; verb: string }[];
  file_types: { attachments: string[]; file_fields: string[]; max_mb: number; max_attachments: number };
  policy: Policy;
  me: { id: number; name: string; is_vault_admin: boolean; department_id: number | null; manager_user_id: number | null };
}

export interface Can { reveal: boolean; copy: boolean; edit: boolean; share: boolean; delete: boolean; remove: boolean; edit_protection: boolean }
export interface UnlockState {
  state: 'locked' | 'pending' | 'progress' | 'open';
  label: string; stage?: LockStep; request_id?: number; code?: string;
  waiting_for?: { name: string; role: string } | null;
  step?: { number: number; of: number };
  expires_at?: string; seconds_left?: number; total_seconds?: number;
}
export interface CredentialRow {
  id: number; code: string; critical_code: string | null; type: string; type_label: string; category_group: string;
  name: string; url: string | null; username: string | null; scope: 'personal' | 'team';
  owner: { id: number; name: string | null; initials: string; is_me: boolean };
  department: { id: number; name: string | null } | null;
  risk: Risk; strength: number; strength_label: string; strength_pct: number; has_password: boolean; twofa: Twofa;
  rotation_days: number | null; next_rotation_due: string | null; rotation_state: 'ok' | 'soon' | 'over' | null;
  protected: boolean; lock_steps: LockStep[];
  access: { permission: Perm; via: Via } | null; can: Can | null; unlock: UnlockState | null;
  active_shares: number; created_at: string | null; updated_at: string | null;
}
export interface DetailField { key: string; label: string; kind: string; value: string | null; masked: boolean; has_value: boolean; attachment_key?: string | null }
export interface Attachment { key: string; name: string; size: number; mime: string; at: string }
export interface PlanStep { step: number; key: LockStep; label: string; approver: { id: number | null; name: string; initials: string; role: string } | null; ready: boolean }
export interface CredentialDetail extends CredentialRow {
  locked: boolean; updated_by: string | null;
  fields?: DetailField[];
  recovery?: { reg_email: string | null; reg_phone: string | null; has_recovery_key: boolean };
  notes?: string | null; attachments?: Attachment[];
  shares?: ShareRow[];
  protection?: { admin: boolean; admin_user: { id: number; name: string } | null; manager: boolean; manager_user: { id: number; name: string } | null; otp: boolean; otp_linked: boolean; policy: { admin: boolean; manager: boolean; otp: boolean } };
  unlock_plan?: { steps: PlanStep[]; of: number; durations: number[]; asks_reason: boolean; default_minutes: number };
  last_request?: AccessRequestRow | null;
  health?: { resolved: { type: string; severity: string; issue: string }[]; still_open: { type: string; severity: string; issue: string }[] };
}

export interface ShareRow {
  id: number;
  credential: { id: number; code: string; name: string; type: string; type_label: string; category_group: string | null; risk: Risk; url: string | null; updated_at: string | null } | null;
  recipient: { type: 'user' | 'team'; id: number; name: string | null; initials?: string; sub: string; members?: number | null };
  permission: Perm; permission_label: string; reason: string | null;
  shared_at: string | null; updated_at: string | null; expires_at: string | null; revoked_at: string | null;
  state: 'active' | 'soon' | 'expired' | 'revoked';
}

export interface Chip { id: number; name: string; initials: string }
export interface AccessRequestRow {
  id: number; code: string;
  credential: { id: number; code: string; critical_code: string | null; name: string; type: string; type_label: string; category_group: string; risk: Risk; url: string | null; in_bin: boolean } | null;
  requester: { id: number; name: string | null; initials: string; designation: string | null; department: string | null; role_line: string | null; is_me: boolean };
  reason: string | null; duration_minutes: number; duration_label: string;
  admin: { user: Chip | null; any_admin: boolean; status: string | null; decided_at: string | null; decided_by: Chip | null; note: string | null } | null;
  manager: { user: Chip | null; status: string; decided_at: string | null; decided_by: Chip | null; note: string | null } | null;
  otp: { verified_at: string | null; attempts_left: number } | null;
  status: 'pending' | 'approved' | 'unlocked' | 'locked' | 'rejected' | 'cancelled';
  display_status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'reset';
  status_label: string; stage: LockStep | null; stage_label: string | null; steps: LockStep[];
  step: { number: number; of: number; label: string } | null;
  unlocked_at: string | null; expires_at: string | null; seconds_left: number; total_seconds: number; locked_reason: string | null;
  can: { approve: boolean; reject: boolean; cancel: boolean; verify_otp: boolean; lock: boolean };
  created_at: string | null;
}

export interface HealthIssue {
  type: 'weak' | 'reused' | 'twofa' | 'rotation' | 'shared'; severity: 'critical' | 'high' | 'medium';
  issue: string; detail: string; details: Record<string, unknown>; action: string; can_fix: boolean;
  credential: { id: number; code: string; name: string; type: string | null; type_label: string | null; category_group: string | null; url: string | null; risk: Risk | null; scope: string | null; owner: string; strength: number | null; strength_pct?: number; has_password: boolean | null };
  resolved_at?: string; resolved_by?: string | null;
}

export interface Policy {
  min_strength: number; rotation_default: number | null; rotation_warn: number; gen_length: number; gen_symbols: boolean;
  twofa_risks: Risk[]; share_critical: boolean; share_max_days: number; share_reason: boolean; overshare_limit: number;
  cp_admin: boolean; cp_admin_user_id: number | null; cp_manager: boolean; cp_otp: boolean; cp_max_minutes: number;
  bin_days: number; bin_purge: boolean;
}
export interface PolicyRule { key: keyof Policy; section: string; label: string; description: string; applies_to: string[]; control: 'seg' | 'multi' | 'switch' | 'admin'; default: unknown; options: { value: unknown; label: string }[] | null }

export interface AuditEvent {
  id: number; event_id: string; at: string;
  actor: { id: number | null; name: string; full_name: string; initials: string; role: string; is_me: boolean };
  action: string; label: string; verb: string; severity: 'info' | 'warn' | 'critical'; severity_label: string;
  credential: { id: number; code: string | null; name: string | null; risk: Risk | null; type: string | null } | null;
  target: string; module: string | null; detail: string | null; ip: string | null;
}

export interface TransferRow {
  id: number; code: string; kind: 'import' | 'export' | 'backup'; scope: string | null; scope_label: string | null;
  format: string; format_label: string; file_name: string | null; source: string | null;
  items: number; skipped: number; weak: number; duplicates: number; size_bytes: number | null;
  include_passwords: boolean; locked: boolean; status: 'done' | 'failed'; failure_reason: string | null;
  by: string | null; by_id: number; by_me: boolean | null; by_role: string | null; at: string | null;
}

export interface BinRow {
  id: number; code: string; name: string; type: string; type_label: string; category_group: string; url: string | null;
  scope: string; risk: Risk; owner: { id: number; name: string | null; is_me: boolean };
  deleted_by: { id: number | null; name: string | null }; deleted_at: string; purges_at: string;
  days_left: number; left_pct: number; urgency: 'bad' | 'warn' | 'ok'; can_purge: boolean;
}

export interface ImportPreviewRow {
  index: number; name: string; url: string; username: string; category: string; strength: number; strength_label: string;
  flags: ('invalid' | 'nopw' | 'dup' | 'dupfile' | 'weak')[]; dup_of: { id: number; code: string; name: string } | null;
  ok: boolean; ready: boolean; selected: boolean; has_password: boolean;
}
export interface ImportPreview {
  token: string; expires_in: number; file_name: string; format: string; format_label: string; source: string;
  columns: Record<string, string>; demo: boolean;
  stats: { rows: number; ready: number; duplicates: number; weak: number; cannot: number; selected: number };
  rows: ImportPreviewRow[];
}

/* Free-form payloads (dashboard, team hierarchy, policy insights) are typed loosely: the screens read named keys. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Loose = Record<string, any>;

/* ══════════════════════════════ CALLS ══════════════════════════════ */

let metaCache: Promise<Meta> | null = null;

export const cvApi = {
  /* Setup */
  meta: (fresh = false): Promise<Meta> => {
    if (!metaCache || fresh) metaCache = get<{ data: Meta }>('/meta').then(r => r.data).catch(e => { metaCache = null; throw e; });
    return metaCache;
  },
  approvers: (q?: string) => get<{ data: Loose }>('/approvers', { q }).then(r => r.data),
  newAuthenticator: (label?: string) => send<{ data: { secret: string; secret_display: string; otpauth_uri: string; works_with: string } }>('post', '/authenticator/new', { label }).then(r => r.data),
  generatePassword: (opts: Loose = {}) => send<{ data: { password: string; bits: number; level: string; strength: number; meets_policy: boolean } }>('post', '/generate-password', opts).then(r => r.data),
  dashboard: (range = 14) => get<{ data: Loose }>('/dashboard', { range, tz: viewerTz() }).then(r => r.data),

  /* Credentials */
  list: (q: Q) => get<ListResponse<CredentialRow> & { member: Loose | null }>('/credentials', q),
  nextCode: () => get<{ data: { next_code: string } }>('/credentials/next-code').then(r => r.data.next_code),
  show: (id: number) => get<{ data: CredentialDetail }>(`/credentials/${id}`).then(r => r.data),
  /** JSON, or FormData when files go with it (sent as POST — PHP reads no multipart PUT). */
  create: (body: Loose | FormData) => send<{ data: CredentialDetail; message: string }>('post', '/credentials', body),
  update: (id: number, body: Loose | FormData) => (body instanceof FormData
    ? send<{ data: CredentialDetail; message: string }>('post', `/credentials/${id}`, body)
    : send<{ data: CredentialDetail; message: string }>('put', `/credentials/${id}`, body)),
  remove: (id: number) => send<{ message: string; data: { id: number; purges_at?: string; removed_share?: boolean } }>('delete', `/credentials/${id}`),
  reveal: (id: number, action: 'reveal' | 'copy', field?: string) => send<{ data: { field: string; label: string; value: string; hide_after_seconds: number; clear_clipboard_after: number } }>('post', `/credentials/${id}/reveal`, { action, field }).then(r => r.data),
  event: (id: number, action: 'view' | 'launch' | 'copy', field?: string) => send('post', `/credentials/${id}/events`, { action, field }),
  activity: (id: number, page = 1) => get<{ data: AuditEvent[]; meta: PageMeta }>(`/credentials/${id}/activity`, { page }),
  attachment: (id: number, key: string) => download('get', `/credentials/${id}/attachments/${key}`),

  /* Sharing */
  recipients: (q?: string) => get<{ data: { users: Loose[]; teams: Loose[] } }>('/share-recipients', { q }).then(r => r.data),
  share: (id: number, body: Loose) => send<{ data: ShareRow; message: string }>('post', `/credentials/${id}/shares`, body),
  sharedByMe: (q: Q) => get<ListResponse<ShareRow>>('/shares', q),
  revoke: (shareId: number) => send<{ data: ShareRow; message: string }>('delete', `/shares/${shareId}`),

  /* Team Vault */
  departments: (q?: string) => get<{ data: Loose }>('/team/departments', { q }).then(r => r.data),
  department: (id: number) => get<{ data: Loose }>(`/team/departments/${id}`).then(r => r.data),
  organisation: () => get<{ data: Loose }>('/team/organisation').then(r => r.data),

  /* Access requests */
  requestAccess: (credId: number, body: { reason?: string; duration_minutes?: number }) => send<{ data: AccessRequestRow; message: string }>('post', `/credentials/${credId}/access-requests`, body),
  requests: (q: Q) => get<ListResponse<AccessRequestRow>>('/access-requests', q),
  request: (id: number) => get<{ data: AccessRequestRow }>(`/access-requests/${id}`).then(r => r.data),
  approve: (id: number, note?: string) => send<{ data: AccessRequestRow; message: string }>('post', `/access-requests/${id}/approve`, { note }),
  reject: (id: number, note?: string) => send<{ data: AccessRequestRow; message: string }>('post', `/access-requests/${id}/reject`, { note }),
  cancel: (id: number) => send<{ data: AccessRequestRow; message: string }>('post', `/access-requests/${id}/cancel`, {}),
  verifyOtp: (id: number, code: string) => send<{ data: AccessRequestRow; message: string }>('post', `/access-requests/${id}/verify-otp`, { code }),
  lock: (id: number) => send<{ data: AccessRequestRow; message: string }>('post', `/access-requests/${id}/lock`, {}),

  /* Password Health */
  health: (q: Q) => get<{ data: HealthIssue[]; tabs: Record<string, number>; meta: PageMeta; summary: Loose }>('/health', q),

  /* Policies */
  policies: () => get<{ data: Loose }>('/policies').then(r => r.data),
  savePolicies: (changes: Partial<Policy>) => send<{ message: string; data: { settings: Policy; changed: string[]; purged?: number; warnings: Loose[] } }>('put', '/policies', changes),
  resetPolicies: () => send<{ message: string; data: { settings: Policy; changed: string[] } }>('post', '/policies/reset', {}),
  policyHistory: (page = 1) => get<{ data: Loose[]; stats: Loose; meta: PageMeta }>('/policies/history', { page }),

  /* Audit */
  audit: (q: Q) => get<{ data: AuditEvent[]; tabs: Record<string, number>; meta: PageMeta; summary: Loose }>('/audit-logs', { ...q, tz: viewerTz() }),
  auditExport: (q: Q) => download('get', '/audit-logs/export', undefined, { ...q, tz: viewerTz() }),

  /* Import & Recovery */
  importSample: (format: 'xlsx' | 'csv' | 'json') => download('get', '/imports/sample', undefined, { format }),
  importPreview: (file: File | 'sample') => {
    if (file === 'sample') return send<{ data: ImportPreview }>('post', '/imports/preview', { sample: true }).then(r => r.data);
    const fd = new FormData(); fd.append('file', file);
    return send<{ data: ImportPreview }>('post', '/imports/preview', fd).then(r => r.data);
  },
  importRun: (body: { token: string; rows: number[]; duplicates: 'skip' | 'copy'; scope?: string; department_id?: number }) => send<{ data: TransferRow; message: string }>('post', '/imports', body),
  imports: (page = 1) => get<{ data: TransferRow[]; meta: PageMeta }>('/imports', { page }),
  backup: (body: Loose) => download('post', '/backups', body),
  backups: (mine = false, page = 1) => get<{ data: TransferRow[]; meta: PageMeta; scopes: Loose[]; columns: Loose; lock_note: string }>('/backups', { mine: mine ? 1 : undefined, page }),
  exportPreview: (scope: 'team' | 'personal') => get<{ data: Loose }>('/exports/preview', { scope }).then(r => r.data),
  exportRun: (body: Loose) => download('post', '/exports', body),
  exports: (page = 1) => get<{ data: TransferRow[]; meta: PageMeta }>('/exports', { page }),

  /* Recycle Bin */
  bin: (q: Q) => get<ListResponse<BinRow> & { summary: Loose; purged: number }>('/recycle-bin', q),
  restore: (id: number) => send<{ message: string }>('post', `/recycle-bin/${id}/restore`, {}),
  purge: (id: number) => send<{ message: string }>('delete', `/recycle-bin/${id}`, { confirm: true }),
  emptyBin: () => send<{ message: string }>('delete', '/recycle-bin', { confirm: true }),
};

/** Routes of the ten screens — the menu, the quick actions and cross-screen links use these. */
export const CV_ROUTES = {
  dashboard: '/credentials-vault/dashboard',
  health: '/credentials-vault/password-health',
  myVault: '/credentials-vault/my-vault',
  teamVault: '/credentials-vault/team-vault',
  critical: '/credentials-vault/critical-vault',
  requests: '/credentials-vault/access-requests',
  policies: '/credentials-vault/policies',
  importRecovery: '/credentials-vault/import-recovery',
  audit: '/credentials-vault/audit-logs',
  bin: '/credentials-vault/recycle-bin',
} as const;
