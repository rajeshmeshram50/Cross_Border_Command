import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Spinner } from 'reactstrap';
import api from '../api';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { Shimmer } from '../components/ui/Shimmer';

// ── Types ────────────────────────────────────────────────────────────────────
interface EmailRow {
  id: number;
  category: string | null;
  from_email: string | null;
  from_name: string | null;
  to_email: string | null;
  to_name: string | null;
  subject: string | null;
  snippet?: string | null;
  has_attachments: boolean;
  status: string;
  is_read: boolean;
  is_starred: boolean;
  sent_at: string | null;
  created_at: string;
  branch?: { id: number; name: string; is_main?: boolean } | null;
  employee?: { id: number; display_name: string | null; first_name: string | null; last_name: string | null; emp_code: string | null } | null;
  sender?: { id: number; name: string; user_type: string } | null;
}

interface EmailDetail extends EmailRow {
  cc: { email: string; name: string | null }[] | null;
  bcc: { email: string; name: string | null }[] | null;
  body_html: string | null;
  body_text: string | null;
  mailable_class: string | null;
  client?: { id: number; org_name: string } | null;
}

interface Stats {
  total: number; unread: number; sent: number; failed: number;
  branch: number; employee: number; composed: number; starred: number; trash: number;
}

type Recipient = { id: number; name: string; email: string; code?: string | null };
type Folder = 'all' | 'sent' | 'starred' | 'branch' | 'employee' | 'trash';

// Category → label + colour, so each mail kind reads at a glance.
const CATEGORY_META: Record<string, { label: string; bg: string; fg: string }> = {
  otp:          { label: 'OTP',          bg: '#fee2e2', fg: '#b91c1c' },
  password:     { label: 'Password',     bg: '#fef3c7', fg: '#a16207' },
  credentials:  { label: 'Credentials',  bg: '#e0e7ff', fg: '#4338ca' },
  onboarding:   { label: 'Onboarding',   bg: '#dcfce7', fg: '#15803d' },
  payslip:      { label: 'Payslip',      bg: '#cffafe', fg: '#0e7490' },
  announcement: { label: 'Announcement', bg: '#ede9fe', fg: '#5a3fd1' },
  recruitment:  { label: 'Recruitment',  bg: '#fce7f3', fg: '#be185d' },
  sales:        { label: 'Sales',        bg: '#dbeafe', fg: '#1d4ed8' },
  signature:    { label: 'Signature',    bg: '#f3e8ff', fg: '#7e22ce' },
  billing:      { label: 'Billing',      bg: '#dcfce7', fg: '#047857' },
  composed:     { label: 'Composed',     bg: '#fef9c3', fg: '#854d0e' },
  other:        { label: 'System',       bg: '#f3f4f6', fg: '#4b5563' },
};
const catMeta = (c: string | null) => CATEGORY_META[c || 'other'] || CATEGORY_META.other;

const fmtDateTime = (d: string | null) =>
  d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

// Gmail-style relative date: time if today, "DD MMM" otherwise.
const fmtListDate = (d: string | null) => {
  if (!d) return '—';
  const dt = new Date(d);
  const now = new Date();
  const sameDay = dt.toDateString() === now.toDateString();
  return sameDay
    ? dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};

const empName = (e: EmailRow['employee']) =>
  e ? (e.display_name?.trim() || `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim() || '—') : null;

// ── Page ─────────────────────────────────────────────────────────────────────
export default function Gmail() {
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();

  const [folder, setFolder] = useState<Folder>('all');
  const [rows, setRows] = useState<EmailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [perPage] = useState(25);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<EmailDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const loadStats = useCallback(async () => {
    try { const { data } = await api.get('/emails/stats'); setStats(data?.data ?? null); }
    catch { setStats(null); }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/emails', {
        params: { folder, search: debounced || undefined, unread: unreadOnly ? 1 : undefined, page, per_page: perPage },
      });
      setRows(Array.isArray(data?.data) ? data.data : []);
      setLastPage(data?.meta?.last_page ?? 1);
      setTotal(data?.meta?.total ?? 0);
      setSelected(new Set());
    } catch (err: any) {
      toast.error('Could not load emails', err?.response?.data?.message || 'Please try again.');
      setRows([]);
    } finally { setLoading(false); }
  }, [folder, debounced, unreadOnly, page, perPage, toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadStats(); }, [loadStats]);

  const switchFolder = (f: Folder) => { setFolder(f); setPage(1); setOpenId(null); setSelected(new Set()); };

  const openEmail = async (id: number) => {
    setOpenId(id);
    setDetailLoading(true);
    setDetail(null);
    // optimistic: mark the row read locally + adjust unread count
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, is_read: true } : r)));
    setStats((s) => (s ? { ...s, unread: Math.max(0, s.unread - (rows.find((r) => r.id === id && !r.is_read) ? 1 : 0)) } : s));
    try {
      const { data } = await api.get(`/emails/${id}`);
      setDetail(data?.data ?? null);
    } catch (err: any) {
      toast.error('Could not open email', err?.response?.data?.message || 'Please try again.');
      setOpenId(null);
    } finally { setDetailLoading(false); }
  };

  // Bulk action over an explicit id set (defaults to current selection).
  const runBulk = async (action: string, ids?: number[]) => {
    const target = ids ?? Array.from(selected);
    if (target.length === 0) return;
    setBusy(true);
    try {
      await api.post('/emails/bulk', { ids: target, action });
      await Promise.all([load(), loadStats()]);
    } catch (err: any) {
      toast.error('Action failed', err?.response?.data?.message || 'Please try again.');
    } finally { setBusy(false); }
  };

  const toggleStar = async (e: React.MouseEvent, row: EmailRow) => {
    e.stopPropagation();
    const next = !row.is_starred;
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, is_starred: next } : r)));
    try { await api.post('/emails/bulk', { ids: [row.id], action: next ? 'star' : 'unstar' }); loadStats(); }
    catch { setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, is_starred: !next } : r))); }
  };

  const toggleSelect = (id: number) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleSelectAll = () =>
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));

  const emptyTrash = async () => {
    const ok = await confirm({
      title: 'Empty Trash?', message: 'Permanently delete all emails in Trash? This cannot be undone.',
      confirmLabel: 'Delete forever', cancelLabel: 'Cancel', tone: 'danger', icon: 'delete-bin-line',
    });
    if (!ok) return;
    await runBulk('delete', rows.map((r) => r.id));
  };

  const FOLDERS: { id: Folder; label: string; icon: string; count?: number; activeIcon?: string }[] = [
    { id: 'all',      label: 'All Mail',    icon: 'ri-mail-line',         count: stats?.total },
    { id: 'sent',     label: 'Sent',        icon: 'ri-send-plane-line',   count: stats?.composed },
    { id: 'starred',  label: 'Starred',     icon: 'ri-star-line',         count: stats?.starred },
    { id: 'branch',   label: 'By Branch',   icon: 'ri-git-branch-line',   count: stats?.branch },
    { id: 'employee', label: 'By Employee', icon: 'ri-team-line',         count: stats?.employee },
    { id: 'trash',    label: 'Trash',       icon: 'ri-delete-bin-line',   count: stats?.trash },
  ];

  return (
    <div className="gm-shell">
      <GmailStyles />
      {/* ── Left rail ──────────────────────────────────────────────── */}
      <aside className="gm-rail">
        <button type="button" className="gm-compose-btn" onClick={() => setComposeOpen(true)}>
          <i className="ri-pencil-fill" /> <span>Compose</span>
        </button>
        <nav className="gm-folders">
          {FOLDERS.map((f) => {
            const active = folder === f.id;
            return (
              <button key={f.id} type="button" className={`gm-folder ${active ? 'active' : ''}`} onClick={() => switchFolder(f.id)}>
                <i className={f.icon} />
                <span className="gm-folder-label">{f.label}</span>
                {typeof f.count === 'number' && f.count > 0 && <span className="gm-folder-count">{f.count}</span>}
              </button>
            );
          })}
          <div className="gm-rail-divider" />
          <button type="button" className={`gm-folder ${unreadOnly ? 'active' : ''}`} onClick={() => { setUnreadOnly((v) => !v); setPage(1); }}>
            <i className="ri-mail-unread-line" />
            <span className="gm-folder-label">Unread only</span>
            {stats && stats.unread > 0 && <span className="gm-folder-count gm-unread-count">{stats.unread}</span>}
          </button>
        </nav>
      </aside>

      {/* ── Main column ────────────────────────────────────────────── */}
      <main className="gm-main">
        {/* Top bar: back + search */}
        <div className="gm-topbar">
          <button type="button" className="gm-icon-btn" title="Back" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/dashboard'))}>
            <i className="ri-arrow-left-line" />
          </button>
          <div className="gm-search">
            <i className="ri-search-line" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search mail" />
            {search && <i className="ri-close-line gm-search-clear" onClick={() => setSearch('')} />}
          </div>
          <div className="gm-brand"><i className="ri-mail-send-fill" /> Gmail</div>
        </div>

        {openId ? (
          /* ── Reading pane ── */
          <ReadingPane
            detail={detail}
            loading={detailLoading}
            onBack={() => { setOpenId(null); setDetail(null); }}
            onTrash={async () => { await runBulk(folder === 'trash' ? 'restore' : 'trash', [openId]); setOpenId(null); }}
            inTrash={folder === 'trash'}
            onUnread={async () => { await runBulk('unread', [openId]); setOpenId(null); }}
            onStar={async () => { if (detail) { await runBulk(detail.is_starred ? 'unstar' : 'star', [openId]); setDetail({ ...detail, is_starred: !detail.is_starred }); } }}
          />
        ) : (
          <>
            {/* Action toolbar */}
            <div className="gm-toolbar">
              <label className="gm-check" title="Select all">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
              </label>
              <button type="button" className="gm-icon-btn" title="Refresh" onClick={() => { load(); loadStats(); }} disabled={busy}>
                <i className="ri-refresh-line" />
              </button>

              {selected.size > 0 ? (
                <div className="gm-bulk">
                  <span className="gm-bulk-count">{selected.size} selected</span>
                  {folder === 'trash' ? (
                    <>
                      <button type="button" className="gm-icon-btn" title="Restore" onClick={() => runBulk('restore')} disabled={busy}><i className="ri-inbox-unarchive-line" /></button>
                      <button type="button" className="gm-icon-btn danger" title="Delete forever" onClick={() => runBulk('delete')} disabled={busy}><i className="ri-delete-bin-7-line" /></button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="gm-icon-btn" title="Mark read" onClick={() => runBulk('read')} disabled={busy}><i className="ri-mail-open-line" /></button>
                      <button type="button" className="gm-icon-btn" title="Mark unread" onClick={() => runBulk('unread')} disabled={busy}><i className="ri-mail-unread-line" /></button>
                      <button type="button" className="gm-icon-btn" title="Star" onClick={() => runBulk('star')} disabled={busy}><i className="ri-star-line" /></button>
                      <button type="button" className="gm-icon-btn" title="Trash" onClick={() => runBulk('trash')} disabled={busy}><i className="ri-delete-bin-line" /></button>
                    </>
                  )}
                </div>
              ) : (
                <span className="gm-toolbar-title">
                  {FOLDERS.find((f) => f.id === folder)?.label}
                  {unreadOnly ? ' · Unread' : ''}
                </span>
              )}

              <div className="gm-pager">
                {folder === 'trash' && rows.length > 0 && (
                  <button type="button" className="gm-text-btn" onClick={emptyTrash} disabled={busy}>Empty trash</button>
                )}
                <span className="gm-pager-range">
                  {total === 0 ? '0' : `${(page - 1) * perPage + 1}–${Math.min(page * perPage, total)} of ${total}`}
                </span>
                <button type="button" className="gm-icon-btn" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}><i className="ri-arrow-left-s-line" /></button>
                <button type="button" className="gm-icon-btn" disabled={page >= lastPage} onClick={() => setPage((p) => Math.min(lastPage, p + 1))}><i className="ri-arrow-right-s-line" /></button>
              </div>
            </div>

            {/* List */}
            <div className="gm-list">
              {loading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="gm-shim-row"><Shimmer height={14} radius={6} /></div>
                ))
              ) : rows.length === 0 ? (
                <div className="gm-empty">
                  <i className="ri-inbox-2-line" />
                  <div className="gm-empty-title">{folder === 'trash' ? 'Trash is empty' : 'No emails here'}</div>
                  <div className="gm-empty-sub">Mail the system sends appears here automatically.</div>
                </div>
              ) : (
                rows.map((r) => {
                  const cm = catMeta(r.category);
                  const eN = empName(r.employee);
                  const isSel = selected.has(r.id);
                  return (
                    <div
                      key={r.id}
                      className={`gm-row ${r.is_read ? 'read' : 'unread'} ${isSel ? 'selected' : ''}`}
                      onClick={() => openEmail(r.id)}
                    >
                      <label className="gm-check" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={isSel} onChange={() => toggleSelect(r.id)} />
                      </label>
                      <button type="button" className={`gm-star ${r.is_starred ? 'on' : ''}`} title={r.is_starred ? 'Starred' : 'Star'} onClick={(e) => toggleStar(e, r)}>
                        <i className={r.is_starred ? 'ri-star-fill' : 'ri-star-line'} />
                      </button>
                      <span className="gm-avatar" style={{ background: cm.bg, color: cm.fg }}>
                        {(r.to_name || r.to_email || '?').charAt(0).toUpperCase()}
                      </span>
                      <span className="gm-row-sender" title={r.to_email || ''}>{r.to_name || r.to_email || '—'}</span>
                      <span className="gm-row-main">
                        <span className="gm-row-subject">{r.subject || '(no subject)'}</span>
                        <span className="gm-row-snippet"> — {r.snippet || 'No preview'}</span>
                      </span>
                      <span className="gm-chip" style={{ background: cm.bg, color: cm.fg }}>{cm.label}</span>
                      {r.status === 'failed' && <span className="gm-chip gm-chip-fail">FAILED</span>}
                      {r.has_attachments && <i className="ri-attachment-2 gm-attach" />}
                      {eN && <span className="gm-row-emp" title={`Employee: ${eN}`}><i className="ri-user-3-line" /></span>}
                      <span className="gm-row-date">{fmtListDate(r.sent_at || r.created_at)}</span>
                      {/* hover actions */}
                      <span className="gm-row-actions" onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="gm-icon-btn sm" title={folder === 'trash' ? 'Restore' : 'Trash'} onClick={() => runBulk(folder === 'trash' ? 'restore' : 'trash', [r.id])}>
                          <i className={folder === 'trash' ? 'ri-inbox-unarchive-line' : 'ri-delete-bin-line'} />
                        </button>
                        <button type="button" className="gm-icon-btn sm" title={r.is_read ? 'Mark unread' : 'Mark read'} onClick={() => runBulk(r.is_read ? 'unread' : 'read', [r.id])}>
                          <i className={r.is_read ? 'ri-mail-unread-line' : 'ri-mail-open-line'} />
                        </button>
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </main>

      {/* ── Floating compose dock ──────────────────────────────────── */}
      {composeOpen && (
        <ComposeDock
          onClose={() => setComposeOpen(false)}
          onSent={() => { setComposeOpen(false); switchFolder('sent'); load(); loadStats(); }}
        />
      )}
    </div>
  );
}

// ── Reading pane ──────────────────────────────────────────────────────────────
function ReadingPane({ detail, loading, onBack, onTrash, onUnread, onStar, inTrash }: {
  detail: EmailDetail | null; loading: boolean; onBack: () => void;
  onTrash: () => void; onUnread: () => void; onStar: () => void; inTrash: boolean;
}) {
  const [showMeta, setShowMeta] = useState(false);
  if (loading || !detail) {
    return (
      <div className="gm-reading">
        <div className="gm-reading-toolbar"><button className="gm-icon-btn" onClick={onBack}><i className="ri-arrow-left-line" /></button></div>
        <div className="text-center py-5"><Spinner /></div>
      </div>
    );
  }
  const cm = catMeta(detail.category);
  const eN = empName(detail.employee);
  return (
    <div className="gm-reading">
      <div className="gm-reading-toolbar">
        <button className="gm-icon-btn" title="Back" onClick={onBack}><i className="ri-arrow-left-line" /></button>
        <button className="gm-icon-btn" title={inTrash ? 'Restore' : 'Trash'} onClick={onTrash}><i className={inTrash ? 'ri-inbox-unarchive-line' : 'ri-delete-bin-line'} /></button>
        <button className="gm-icon-btn" title="Mark unread" onClick={onUnread}><i className="ri-mail-unread-line" /></button>
        <button className={`gm-icon-btn ${detail.is_starred ? 'star-on' : ''}`} title="Star" onClick={onStar}><i className={detail.is_starred ? 'ri-star-fill' : 'ri-star-line'} /></button>
      </div>

      <div className="gm-reading-body">
        <div className="gm-reading-head">
          <h2 className="gm-reading-subject">{detail.subject || '(no subject)'}</h2>
          <span className="gm-chip" style={{ background: cm.bg, color: cm.fg }}>{cm.label}</span>
        </div>

        <div className="gm-reading-from">
          <span className="gm-avatar lg" style={{ background: cm.bg, color: cm.fg }}>{(detail.to_name || detail.to_email || '?').charAt(0).toUpperCase()}</span>
          <div className="gm-reading-from-text">
            <div className="gm-reading-from-line">
              <strong>{detail.from_name || detail.from_email || 'System'}</strong>
              <span className="gm-muted"> &lt;{detail.from_email}&gt;</span>
              <span className="gm-reading-date">{fmtDateTime(detail.sent_at || detail.created_at)}</span>
            </div>
            <div className="gm-reading-to" onClick={() => setShowMeta((v) => !v)}>
              to {detail.to_name || detail.to_email} <i className={showMeta ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
            </div>
            {showMeta && (
              <div className="gm-reading-meta">
                <MetaRow label="From" value={`${detail.from_name || ''} <${detail.from_email || '—'}>`} />
                <MetaRow label="To" value={`${detail.to_name || ''} <${detail.to_email}>`} />
                {detail.cc?.length ? <MetaRow label="Cc" value={detail.cc.map((c) => c.email).join(', ')} /> : null}
                <MetaRow label="Date" value={fmtDateTime(detail.sent_at || detail.created_at)} />
                <MetaRow label="Status" value={detail.status} />
                {detail.branch?.name ? <MetaRow label="Branch" value={detail.branch.name} /> : null}
                {eN ? <MetaRow label="Employee" value={eN + (detail.employee?.emp_code ? ` (${detail.employee.emp_code})` : '')} /> : null}
                {detail.sender?.name ? <MetaRow label="Triggered by" value={detail.sender.name} /> : null}
                <MetaRow label="Kind" value={cm.label} />
              </div>
            )}
          </div>
        </div>

        {detail.body_html ? (
          <iframe title="email-body" sandbox="" srcDoc={detail.body_html} className="gm-reading-iframe" />
        ) : (
          <pre className="gm-reading-text">{detail.body_text || '(no content captured)'}</pre>
        )}
      </div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return <div className="gm-meta-row"><span className="gm-meta-label">{label}:</span><span className="gm-meta-value">{value}</span></div>;
}

// ── Floating compose dock ─────────────────────────────────────────────────────
function ComposeDock({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const toast = useToast();
  const [all, setAll] = useState<(Recipient & { group: string })[]>([]);
  const [to, setTo] = useState<string[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [cc, setCc] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [acInput, setAcInput] = useState('');
  const [acField, setAcField] = useState<'to' | 'cc'>('to');
  const acRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  // Free-drag position. null = default docked bottom-right.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Drag the window by its header. Defined locally so the move/up listeners
  // share references for clean removal.
  const onHeaderDrag = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.gm-cmp-header-actions')) return; // don't drag from the icons
    const dock = dockRef.current;
    if (!dock) return;
    const rect = dock.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY, baseLeft = rect.left, baseTop = rect.top;
    const w = dock.offsetWidth || 512;
    const move = (ev: MouseEvent) => {
      const left = Math.max(0, Math.min(baseLeft + (ev.clientX - startX), window.innerWidth - Math.min(w, 160)));
      const top = Math.max(0, Math.min(baseTop + (ev.clientY - startY), window.innerHeight - 44));
      setPos({ left, top });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    e.preventDefault();
  };

  // Close the autocomplete dropdown when clicking outside the active field.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (acRef.current && !acRef.current.contains(e.target as Node)) setAcInput('');
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => {
    api.get('/emails/recipients').then(({ data }) => {
      const d = data?.data ?? {};
      const merged = [
        ...(d.employees ?? []).map((r: Recipient) => ({ ...r, group: 'Employee' })),
        ...(d.branches ?? []).map((r: Recipient) => ({ ...r, group: 'Branch' })),
        ...(d.customers ?? []).map((r: Recipient) => ({ ...r, group: 'Customer' })),
      ];
      setAll(merged);
    }).catch(() => setAll([]));
  }, []);

  const suggestions = useMemo(() => {
    const s = acInput.trim().toLowerCase();
    if (!s) return [];
    const chosen = new Set([...to, ...cc]);
    return all.filter((r) => !chosen.has(r.email) && (r.name.toLowerCase().includes(s) || r.email.toLowerCase().includes(s))).slice(0, 6);
  }, [acInput, all, to, cc]);

  const addChip = (email: string, field: 'to' | 'cc') => {
    const setter = field === 'to' ? setTo : setCc;
    setter((prev) => (prev.includes(email) ? prev : [...prev, email]));
    setAcInput('');
  };
  const removeChip = (email: string, field: 'to' | 'cc') =>
    (field === 'to' ? setTo : setCc)((prev) => prev.filter((e) => e !== email));

  const commitTyped = (field: 'to' | 'cc') => {
    const e = acInput.trim();
    if (!e) return;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { toast.error('Invalid email', `"${e}" is not valid.`); return; }
    addChip(e, field);
  };

  const send = async () => {
    if (to.length === 0) { toast.error('Add a recipient', 'Pick at least one recipient.'); return; }
    if (!subject.trim()) { toast.error('Subject required', 'Please add a subject.'); return; }
    if (!body.trim()) { toast.error('Message required', 'Please write a message.'); return; }
    setSending(true);
    try {
      const { data } = await api.post('/emails', { to, cc: cc.length ? cc : undefined, subject: subject.trim(), body });
      toast.success('Email sent', data?.message || `Sent to ${to.length} recipient(s).`);
      onSent();
    } catch (err: any) {
      toast.error('Could not send', err?.response?.data?.message || 'Please try again.');
    } finally { setSending(false); }
  };

  // Rendered as an inline function (NOT <ChipField/>) so the input keeps focus
  // across keystrokes — a locally-defined component would remount each render.
  const renderField = (field: 'to' | 'cc', label: string) => {
    const list = field === 'to' ? to : cc;
    return (
      <div className="gm-cmp-field" ref={field === acField ? acRef : undefined}>
        <span className="gm-cmp-field-label">{label}</span>
        <div className="gm-cmp-chips">
          {list.map((e) => (
            <span key={e} className="gm-cmp-chip">{e}<i className="ri-close-line" onClick={() => removeChip(e, field)} /></span>
          ))}
          <input
            value={acField === field ? acInput : ''}
            onFocus={() => setAcField(field)}
            onChange={(e) => { setAcField(field); setAcInput(e.target.value); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commitTyped(field); } if (e.key === 'Backspace' && !acInput && list.length) removeChip(list[list.length - 1], field); }}
            placeholder={list.length === 0 ? 'Type a name or email…' : ''}
          />
        </div>
        {field === 'to' && (
          <button type="button" className="gm-cmp-cc" onClick={() => setShowCc((v) => !v)}>Cc</button>
        )}
        {acField === field && suggestions.length > 0 && (
          <div className="gm-ac">
            {suggestions.map((r) => (
              <button type="button" key={`${r.group}-${r.id}`} className="gm-ac-item" onClick={() => addChip(r.email, field)}>
                <span className="gm-ac-name">{r.name}</span>
                <span className="gm-ac-email">{r.email}</span>
                <span className="gm-ac-group">{r.group}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      ref={dockRef}
      className={`gm-compose-dock ${minimized ? 'min' : ''} ${pos ? 'floating' : ''}`}
      style={pos ? { left: pos.left, top: pos.top, right: 'auto', bottom: 'auto' } : undefined}
    >
      <div className="gm-cmp-header" onMouseDown={onHeaderDrag} onClick={() => minimized && setMinimized(false)}>
        <span><i className="ri-draggable" style={{ marginRight: 6, opacity: .6 }} />New Message</span>
        <span className="gm-cmp-header-actions">
          <i className={minimized ? 'ri-fullscreen-line' : 'ri-subtract-line'} onClick={(e) => { e.stopPropagation(); setMinimized((v) => !v); }} title={minimized ? 'Expand' : 'Minimize'} />
          <i className="ri-close-line" onClick={(e) => { e.stopPropagation(); onClose(); }} title="Close" />
        </span>
      </div>
      {!minimized && (
        <div className="gm-cmp-body">
          {renderField('to', 'To')}
          {showCc && renderField('cc', 'Cc')}
          <input className="gm-cmp-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
          <textarea className="gm-cmp-text" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your message…" />
          <div className="gm-cmp-footer">
            <button type="button" className="gm-cmp-send" onClick={send} disabled={sending}>
              {sending ? <><Spinner size="sm" /> Sending…</> : <>Send <i className="ri-send-plane-fill" /></>}
            </button>
            <span className="gm-cmp-hint">Wrapped in your org's branded template.</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Styles (Gmail-faithful) ───────────────────────────────────────────────────
function GmailStyles() {
  return (
    <style>{`
    .gm-shell { display:flex; gap:0; height:calc(100vh - 130px); min-height:560px; background:var(--vz-card-bg,#fff); border:1px solid var(--vz-border-color); border-radius:16px; overflow:hidden; }
    /* Rail */
    .gm-rail { width:240px; flex-shrink:0; padding:14px 10px; border-right:1px solid var(--vz-border-color); overflow-y:auto; }
    .gm-compose-btn { display:flex; align-items:center; gap:12px; width:auto; padding:14px 22px 14px 16px; border:0; border-radius:16px; background:#c2e7ff; color:#001d35; font-weight:600; font-size:14px; cursor:pointer; box-shadow:0 1px 3px rgba(0,0,0,.12); margin-bottom:12px; transition:box-shadow .15s, background .15s; }
    .gm-compose-btn:hover { box-shadow:0 2px 8px rgba(0,0,0,.2); background:#b3dffb; }
    .gm-compose-btn i { font-size:18px; }
    .gm-folders { display:flex; flex-direction:column; gap:1px; }
    .gm-folder { display:flex; align-items:center; gap:14px; padding:0 12px 0 18px; height:34px; border:0; border-radius:0 16px 16px 0; background:transparent; color:var(--vz-body-color); font-size:13.5px; font-weight:500; cursor:pointer; text-align:left; }
    .gm-folder:hover { background:var(--vz-secondary-bg); }
    .gm-folder.active { background:#d3e3fd; color:#041e49; font-weight:700; }
    [data-bs-theme="dark"] .gm-folder.active { background:#004a77; color:#c2e7ff; }
    .gm-folder i { font-size:17px; flex-shrink:0; }
    .gm-folder-label { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .gm-folder-count { font-size:12px; font-weight:700; }
    .gm-unread-count { color:#d93025; }
    .gm-rail-divider { height:1px; background:var(--vz-border-color); margin:8px 6px; }
    /* Main */
    .gm-main { flex:1; min-width:0; display:flex; flex-direction:column; }
    .gm-topbar { display:flex; align-items:center; gap:10px; padding:10px 14px; }
    .gm-search { flex:1; max-width:720px; display:flex; align-items:center; gap:10px; background:var(--vz-secondary-bg,#eaf1fb); border-radius:999px; padding:0 16px; height:44px; }
    .gm-search input { flex:1; border:0; background:transparent; outline:none; font-size:14px; color:var(--vz-body-color); }
    .gm-search i { color:#5f6368; font-size:18px; }
    .gm-search-clear { cursor:pointer; }
    .gm-brand { display:flex; align-items:center; gap:6px; font-weight:700; color:#d93025; font-size:16px; margin-left:auto; }
    .gm-brand i { font-size:20px; }
    /* Toolbar */
    .gm-toolbar { display:flex; align-items:center; gap:6px; padding:4px 14px; border-bottom:1px solid var(--vz-border-color); min-height:44px; }
    .gm-toolbar-title { font-weight:700; font-size:13.5px; color:var(--vz-body-color); margin-left:6px; }
    .gm-bulk { display:flex; align-items:center; gap:4px; }
    .gm-bulk-count { font-size:12.5px; font-weight:700; color:#1a73e8; margin:0 6px; }
    .gm-pager { margin-left:auto; display:flex; align-items:center; gap:4px; }
    .gm-pager-range { font-size:12px; color:#5f6368; margin-right:4px; white-space:nowrap; }
    .gm-text-btn { border:0; background:transparent; color:#d93025; font-weight:700; font-size:12.5px; cursor:pointer; margin-right:8px; }
    /* Icon buttons */
    .gm-icon-btn { width:36px; height:36px; border:0; border-radius:50%; background:transparent; color:#5f6368; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; font-size:18px; transition:background .15s; }
    .gm-icon-btn:hover { background:var(--vz-secondary-bg); }
    .gm-icon-btn:disabled { opacity:.35; cursor:default; }
    .gm-icon-btn.danger:hover { color:#d93025; }
    .gm-icon-btn.sm { width:30px; height:30px; font-size:15px; }
    .gm-icon-btn.star-on { color:#f4b400; }
    .gm-check { display:inline-flex; align-items:center; justify-content:center; width:36px; cursor:pointer; }
    .gm-check input { width:16px; height:16px; cursor:pointer; }
    /* List */
    .gm-list { flex:1; overflow-y:auto; }
    .gm-shim-row { padding:13px 16px; border-bottom:1px solid var(--vz-border-color); }
    .gm-row { display:flex; align-items:center; gap:8px; padding:0 12px 0 4px; height:42px; border-bottom:1px solid var(--vz-border-color); cursor:pointer; position:relative; }
    .gm-row:hover { box-shadow:inset 1px 0 0 #dadce0, inset -1px 0 0 #dadce0, 0 1px 2px rgba(60,64,67,.3); z-index:1; }
    .gm-row.unread { background:var(--vz-card-bg,#fff); }
    .gm-row.read { background:var(--vz-secondary-bg,#f2f6fc); }
    .gm-row.selected { background:#c2dbff !important; }
    .gm-star { border:0; background:transparent; color:#c0c4c9; cursor:pointer; font-size:17px; width:28px; height:28px; flex-shrink:0; }
    .gm-star.on { color:#f4b400; }
    .gm-star:hover { color:#9aa0a6; }
    .gm-avatar { width:28px; height:28px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:12px; font-weight:700; flex-shrink:0; }
    .gm-avatar.lg { width:40px; height:40px; font-size:16px; }
    .gm-row-sender { width:168px; flex-shrink:0; font-size:13.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .gm-row.unread .gm-row-sender { font-weight:700; color:var(--vz-heading-color,#202124); }
    .gm-row-main { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13.5px; }
    .gm-row.unread .gm-row-subject { font-weight:700; color:var(--vz-heading-color,#202124); }
    .gm-row-snippet { color:#5f6368; }
    .gm-chip { padding:1px 8px; border-radius:999px; font-size:10px; font-weight:800; flex-shrink:0; letter-spacing:.3px; }
    .gm-chip-fail { background:#fce8e6 !important; color:#c5221f !important; }
    .gm-attach { color:#5f6368; flex-shrink:0; }
    .gm-row-emp { color:#1a73e8; flex-shrink:0; font-size:13px; }
    .gm-row-date { width:64px; text-align:right; flex-shrink:0; font-size:12px; color:#5f6368; }
    .gm-row.unread .gm-row-date { font-weight:700; color:var(--vz-heading-color,#202124); }
    .gm-row-actions { display:none; align-items:center; gap:2px; position:absolute; right:8px; background:inherit; }
    .gm-row:hover .gm-row-actions { display:flex; }
    .gm-row:hover .gm-row-date, .gm-row:hover .gm-row-emp, .gm-row:hover .gm-chip { visibility:hidden; }
    /* Empty */
    .gm-empty { padding:64px 20px; text-align:center; color:#9aa0a6; }
    .gm-empty i { font-size:46px; display:block; margin-bottom:10px; }
    .gm-empty-title { font-size:15px; font-weight:600; color:#5f6368; }
    .gm-empty-sub { font-size:12.5px; }
    /* Reading pane */
    .gm-reading { flex:1; display:flex; flex-direction:column; overflow:hidden; }
    .gm-reading-toolbar { display:flex; align-items:center; gap:4px; padding:6px 14px; border-bottom:1px solid var(--vz-border-color); }
    .gm-reading-body { flex:1; overflow-y:auto; padding:18px 28px 40px; }
    .gm-reading-head { display:flex; align-items:center; gap:12px; margin-bottom:18px; }
    .gm-reading-subject { font-size:22px; font-weight:400; color:var(--vz-heading-color,#202124); margin:0; }
    .gm-reading-from { display:flex; gap:14px; }
    .gm-reading-from-text { flex:1; min-width:0; }
    .gm-reading-from-line { display:flex; align-items:baseline; gap:6px; flex-wrap:wrap; font-size:14px; }
    .gm-reading-date { margin-left:auto; font-size:12.5px; color:#5f6368; }
    .gm-muted { color:#5f6368; font-size:13px; }
    .gm-reading-to { font-size:12.5px; color:#5f6368; cursor:pointer; margin-top:2px; display:inline-flex; align-items:center; gap:2px; }
    .gm-reading-meta { margin-top:8px; background:var(--vz-secondary-bg); border-radius:8px; padding:10px 12px; }
    .gm-meta-row { display:flex; gap:8px; font-size:12.5px; padding:2px 0; }
    .gm-meta-label { color:#5f6368; min-width:90px; text-align:right; }
    .gm-meta-value { color:var(--vz-body-color); word-break:break-word; }
    .gm-reading-iframe { width:100%; height:520px; border:1px solid var(--vz-border-color); border-radius:10px; margin-top:18px; background:#fff; }
    .gm-reading-text { white-space:pre-wrap; font-family:inherit; font-size:14px; margin-top:18px; color:var(--vz-body-color); }
    /* Compose dock */
    .gm-compose-dock { position:fixed; right:24px; bottom:0; width:512px; max-width:calc(100vw - 48px); background:#fff; border-radius:12px 12px 0 0; box-shadow:0 8px 28px rgba(0,0,0,.28); z-index:1200; display:flex; flex-direction:column; }
    [data-bs-theme="dark"] .gm-compose-dock { background:#2a2f34; }
    .gm-compose-dock.min { width:300px; }
    .gm-compose-dock.floating { border-radius:12px; }
    .gm-cmp-header { display:flex; align-items:center; justify-content:space-between; background:#404040; color:#fff; padding:10px 14px; border-radius:12px 12px 0 0; font-size:13.5px; font-weight:600; cursor:move; user-select:none; }
    .gm-compose-dock.floating .gm-cmp-header { border-radius:12px 12px 0 0; }
    .gm-cmp-header-actions i { margin-left:14px; cursor:pointer; font-size:16px; }
    .gm-cmp-body { display:flex; flex-direction:column; padding:6px 16px 14px; }
    .gm-cmp-field { display:flex; align-items:flex-start; gap:8px; border-bottom:1px solid var(--vz-border-color); padding:6px 0; position:relative; }
    .gm-cmp-field-label { font-size:13px; color:#5f6368; padding-top:5px; }
    .gm-cmp-chips { flex:1; display:flex; flex-wrap:wrap; gap:4px; align-items:center; }
    .gm-cmp-chip { background:var(--vz-secondary-bg,#e8eaed); border-radius:999px; padding:2px 8px; font-size:12px; display:inline-flex; align-items:center; gap:4px; }
    .gm-cmp-chip i { cursor:pointer; font-size:13px; }
    .gm-cmp-chips input { flex:1; min-width:120px; border:0; outline:none; background:transparent; font-size:13px; padding:4px 0; color:var(--vz-body-color); }
    .gm-cmp-cc { border:0; background:transparent; color:#5f6368; font-size:12.5px; cursor:pointer; padding-top:4px; }
    .gm-ac { position:absolute; top:100%; left:0; right:0; background:#fff; border:1px solid var(--vz-border-color); border-radius:8px; box-shadow:0 6px 18px rgba(0,0,0,.18); z-index:5; overflow:hidden; }
    [data-bs-theme="dark"] .gm-ac { background:#2a2f34; }
    .gm-ac-item { display:flex; align-items:center; gap:8px; width:100%; border:0; background:transparent; padding:8px 12px; cursor:pointer; text-align:left; }
    .gm-ac-item:hover { background:var(--vz-secondary-bg); }
    .gm-ac-name { font-size:13px; font-weight:600; color:var(--vz-body-color); }
    .gm-ac-email { font-size:12px; color:#5f6368; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .gm-ac-group { font-size:10px; font-weight:800; text-transform:uppercase; color:#1a73e8; }
    .gm-cmp-subject { border:0; border-bottom:1px solid var(--vz-border-color); outline:none; padding:10px 0; font-size:14px; font-weight:600; background:transparent; color:var(--vz-body-color); }
    .gm-cmp-text { border:0; outline:none; padding:12px 0; min-height:200px; resize:vertical; font-size:14px; background:transparent; color:var(--vz-body-color); font-family:inherit; }
    .gm-cmp-footer { display:flex; align-items:center; gap:14px; padding-top:6px; }
    .gm-cmp-send { display:inline-flex; align-items:center; gap:8px; background:#0b57d0; color:#fff; border:0; border-radius:999px; padding:9px 24px; font-weight:600; font-size:14px; cursor:pointer; }
    .gm-cmp-send:hover { background:#0a4bbf; }
    .gm-cmp-send:disabled { opacity:.6; cursor:default; }
    .gm-cmp-hint { font-size:11px; color:#9aa0a6; }
    @media (max-width:991px){ .gm-rail{ width:64px; } .gm-folder-label,.gm-folder-count,.gm-compose-btn span{ display:none; } .gm-compose-btn{ padding:14px; } .gm-row-sender{ width:110px; } }
    `}</style>
  );
}
