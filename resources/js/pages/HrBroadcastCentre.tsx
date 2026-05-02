import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Card, CardBody, Col, Row, Modal, ModalBody, Spinner, Input } from 'reactstrap';
import { MasterSelect, MasterFormStyles, MasterDatePicker } from './master/masterFormKit';
import { useToast } from '../contexts/ToastContext';
import api from '../api';
import '../../css/recruitment.css';

// ── Types ────────────────────────────────────────────────────────────────────
type AnnType    = 'General' | 'Policy' | 'Urgent';
type AnnPriority = 'Normal' | 'High' | 'Critical';
type AnnStatus  = 'Draft' | 'Scheduled' | 'Active' | 'Expired' | 'Archived';
type AudienceType = 'all_employees' | 'roles' | 'designations';
type PublishType  = 'immediate' | 'scheduled';
type AckMode      = 'Mandatory' | 'Optional';
type AckFreq      = 'Daily' | 'Weekly' | 'Never';

interface AnnRow {
  id: number;
  code: string;
  title: string;
  description: string;
  type: AnnType;
  priority: AnnPriority;
  attachment_path: string | null;
  attachment_original_name: string | null;
  attachment_url: string | null;
  audience_type: AudienceType;
  audience_role_ids: number[] | null;
  audience_designation_ids: number[] | null;
  exclude_employee_ids: number[] | null;
  audience_count: number;
  publish_type: PublishType;
  publish_at: string | null;
  expires_at: string | null;
  ack_required: boolean;
  ack_mode: AckMode;
  ack_reminder_frequency: AckFreq;
  ack_escalation_days: number;
  notify_email: boolean;
  notify_in_app: boolean;
  notify_sms: boolean;
  notify_whatsapp: boolean;
  status: AnnStatus;
  created_at: string;
  creator?: { id: number; name: string };
}

interface Stats { total: number; active: number; scheduled: number; draft: number; expired: number; archived: number; }
const ZERO_STATS: Stats = { total: 0, active: 0, scheduled: 0, draft: 0, expired: 0, archived: 0 };

// ── Tone palettes ────────────────────────────────────────────────────────────
const TYPE_TONES: Record<AnnType, { bg: string; fg: string }> = {
  General: { bg: '#e0e7ff', fg: '#4338ca' },
  Policy:  { bg: '#ede9fe', fg: '#6d28d9' },
  Urgent:  { bg: '#fee2e2', fg: '#b91c1c' },
};
const PRIORITY_TONES: Record<AnnPriority, { bg: string; fg: string }> = {
  Normal:   { bg: '#fef3c7', fg: '#92400e' },
  High:     { bg: '#fed7aa', fg: '#c2410c' },
  Critical: { bg: '#fee2e2', fg: '#b91c1c' },
};
const STATUS_TONES: Record<AnnStatus, { bg: string; fg: string; dot: string }> = {
  Draft:     { bg: '#f3f4f6', fg: '#4b5563', dot: '#9ca3af' },
  Scheduled: { bg: '#fef3c7', fg: '#92400e', dot: '#f59e0b' },
  Active:    { bg: '#dcfce7', fg: '#15803d', dot: '#22c55e' },
  Expired:   { bg: '#fee2e2', fg: '#b91c1c', dot: '#ef4444' },
  Archived:  { bg: '#e0e7ff', fg: '#4338ca', dot: '#6366f1' },
};

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatDate(raw: any): string {
  if (raw == null || raw === '') return '—';
  const d = new Date(String(raw));
  if (isNaN(d.getTime())) return String(raw);
  const dd = String(d.getDate()).padStart(2, '0');
  return `${dd} ${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`;
}
function formatDateTime(raw: any): string {
  if (raw == null || raw === '') return '—';
  const d = new Date(String(raw));
  if (isNaN(d.getTime())) return String(raw);
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${dd} ${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}, ${hh}:${mm}`;
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function HrBroadcastCentre() {
  const toast = useToast();

  const [rows, setRows] = useState<AnnRow[]>([]);
  const [stats, setStats] = useState<Stats>(ZERO_STATS);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<AnnRow | null>(null);

  const fetchAll = async () => {
    try {
      setLoading(true);
      const [listRes, statsRes] = await Promise.all([
        api.get('/announcements'),
        api.get('/announcements/stats').catch(() => ({ data: ZERO_STATS })),
      ]);
      setRows(Array.isArray(listRes.data) ? listRes.data : []);
      setStats({ ...ZERO_STATS, ...(statsRes.data || {}) });
    } catch (err: any) {
      toast.error('Could not load announcements', err?.response?.data?.message || 'Please try again.');
      setRows([]);
      setStats(ZERO_STATS);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetchAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  useEffect(() => { setPage(1); }, [search, typeFilter, statusFilter]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows
      .filter(r => typeFilter === 'All' || r.type === typeFilter)
      .filter(r => statusFilter === 'All' || r.status === statusFilter)
      .filter(r => {
        if (!needle) return true;
        return (
          r.title.toLowerCase().includes(needle) ||
          (r.code || '').toLowerCase().includes(needle) ||
          (r.description || '').toLowerCase().includes(needle)
        );
      });
  }, [rows, search, typeFilter, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage  = Math.min(page, pageCount);
  const sliceFrom = (safePage - 1) * pageSize;
  const visible   = filtered.slice(sliceFrom, sliceFrom + pageSize);
  const goto = (p: number) => setPage(Math.max(1, Math.min(pageCount, p)));

  // Same KPI shape the recruitment page uses — gradient on the top
  // accent strip + gradient on the icon tile + deep tone on the number.
  // Looks consistent with the rest of the HR module.
  const KPI_CARDS = [
    { label: 'Total',     value: stats.total,     icon: 'ri-send-plane-fill',     gradient: 'linear-gradient(135deg,#299cdb 0%,#4dabf7 100%)', deep: '#1e6dd6' },
    { label: 'Active',    value: stats.active,    icon: 'ri-checkbox-circle-fill',gradient: 'linear-gradient(135deg,#0ab39c 0%,#22c8a9 100%)', deep: '#089d7a' },
    { label: 'Scheduled', value: stats.scheduled, icon: 'ri-calendar-event-fill', gradient: 'linear-gradient(135deg,#f7b84b 0%,#fbc763 100%)', deep: '#a4661c' },
    { label: 'Draft',     value: stats.draft,     icon: 'ri-draft-line',          gradient: 'linear-gradient(135deg,#878a99 0%,#a3a6b4 100%)', deep: '#5b6478' },
    { label: 'Expired',   value: stats.expired,   icon: 'ri-forbid-2-line',       gradient: 'linear-gradient(135deg,#f06548 0%,#f47c5d 100%)', deep: '#b1401d' },
  ];

  const handleSaved = (saved: AnnRow) => {
    setRows(prev => {
      const idx = prev.findIndex(r => r.id === saved.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = saved; return next; }
      return [saved, ...prev];
    });
    setCreateOpen(false);
    setEditingRow(null);
    fetchAll(); // refresh stats too
  };

  const handleDelete = async (row: AnnRow) => {
    if (!confirm(`Delete announcement ${row.code}? This cannot be undone.`)) return;
    try {
      await api.delete(`/announcements/${row.id}`);
      toast.success('Deleted', `${row.code} removed.`);
      fetchAll();
    } catch (err: any) {
      toast.error('Could not delete', err?.response?.data?.message || 'Please try again.');
    }
  };

  const handlePublishNow = async (row: AnnRow) => {
    try {
      const { data } = await api.put(`/announcements/${row.id}`, {
        status: 'Active',
        publish_type: 'immediate',
        publish_at: null,
      });
      toast.success('Published', `${data.code} is now live.`);
      handleSaved(data);
    } catch (err: any) {
      toast.error('Could not publish', err?.response?.data?.message || 'Please try again.');
    }
  };

  return (
    <>
      <MasterFormStyles />
      <Row>
        <Col xs={12}>
          <div className="rec-page">
            {/* Header */}
            <div className="d-flex align-items-start justify-content-between flex-wrap gap-3 mb-2">
              <div className="d-flex align-items-center gap-3 min-w-0">
                <span className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
                  style={{ width: 46, height: 46, background: 'linear-gradient(135deg, #0ea5e9 0%, #38bdf8 100%)', boxShadow: '0 4px 10px rgba(14,165,233,0.30)' }}>
                  <i className="ri-send-plane-line" style={{ color: '#fff', fontSize: 21 }} />
                </span>
                <div className="min-w-0">
                  <h5 className="fw-bold mb-0">
                    Broadcast Centre
                    <span className="ms-2 rec-pill" style={{ background: '#e0f2fe', color: '#0284c7', fontSize: 11 }}>Communication</span>
                  </h5>
                  <div className="text-muted mt-1" style={{ fontSize: 12.5 }}>
                    Create, schedule and manage company-wide announcements with audience targeting and acknowledgement tracking
                  </div>
                </div>
              </div>
            </div>

            {/* KPI strip — explicit 5-column grid at xl+ so the cards
                stretch the full width (default Col xl=2 leaves 16.67%
                empty on the right since 5 × 2/12 = 10/12). Drops to
                3 at md, 2 at sm, 1 at xs. */}
            <Row className="g-2 mb-2 align-items-stretch rec-page-kpis row-cols-1 row-cols-sm-2 row-cols-md-3 row-cols-xl-5">
              {KPI_CARDS.map(k => (
                <Col key={k.label}>
                  <div className="rec-kpi-card h-100">
                    <span className="rec-kpi-strip" style={{ background: k.gradient }} />
                    <div className="rec-kpi-text">
                      <span className="rec-kpi-label">{k.label}</span>
                      <span className="rec-kpi-num" style={{ color: k.deep }}>{k.value}</span>
                    </div>
                    <span className="rec-kpi-icon" style={{ background: k.gradient }}>
                      <i className={k.icon} />
                    </span>
                  </div>
                </Col>
              ))}
            </Row>

            {/* Filters + table */}
            <Card className="border-0 shadow-none mb-0 bg-transparent">
              <CardBody className="p-0">
                <div className="rec-list-frame">
                  <div className="rec-req-filter-row d-flex align-items-center gap-2 flex-wrap">
                    <div className="rec-req-search search-box" style={{ flex: 1, minWidth: 220 }}>
                      <Input type="text" className="form-control" placeholder="Search announcements…" value={search} onChange={e => setSearch(e.target.value)} />
                      <i className="ri-search-line search-icon"></i>
                    </div>
                    <span className="text-uppercase fw-semibold" style={{ fontSize: 10.5, letterSpacing: '0.06em', color: 'var(--vz-secondary-color)' }}>Type</span>
                    <div style={{ minWidth: 130 }}>
                      <MasterSelect value={typeFilter} onChange={setTypeFilter} options={[{ value: 'All', label: 'All Types' }, { value: 'General', label: 'General' }, { value: 'Policy', label: 'Policy' }, { value: 'Urgent', label: 'Urgent' }]} placeholder="All Types" />
                    </div>
                    <span className="text-uppercase fw-semibold" style={{ fontSize: 10.5, letterSpacing: '0.06em', color: 'var(--vz-secondary-color)' }}>Status</span>
                    <div style={{ minWidth: 140 }}>
                      <MasterSelect value={statusFilter} onChange={setStatusFilter} options={[{ value: 'All', label: 'All Status' }, ...(['Draft','Scheduled','Active','Expired','Archived'] as AnnStatus[]).map(s => ({ value: s, label: s }))]} placeholder="All Status" />
                    </div>
                    <button type="button" className="rec-btn-primary ms-auto" onClick={() => { setEditingRow(null); setCreateOpen(true); }}>
                      <i className="ri-add-line" />New Announcement
                    </button>
                  </div>

                  <div className="rec-list-scroll">
                    <table className="rec-list-table align-middle table-nowrap mb-0">
                      <thead>
                        <tr>
                          <th className="ps-3 text-center" style={{ width: 50 }}>#</th>
                          <th style={{ width: 100 }}>ANN ID</th>
                          <th>Announcement Title</th>
                          <th style={{ width: 100 }}>Type</th>
                          <th style={{ width: 100 }}>Priority</th>
                          <th>Audience</th>
                          <th style={{ width: 110 }}>Status</th>
                          <th style={{ width: 130 }}>Publish Date</th>
                          <th style={{ width: 130 }}>Expiry</th>
                          <th className="text-center pe-3" style={{ width: 180 }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {loading ? (
                          <tr><td colSpan={10} className="text-center py-5 text-muted"><Spinner size="sm" /> Loading announcements…</td></tr>
                        ) : visible.length === 0 ? (
                          <tr><td colSpan={10} className="text-center py-5 text-muted">
                            <i className="ri-send-plane-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                            {rows.length === 0 ? 'No announcements yet — click New Announcement to add one' : 'No announcements match your filters'}
                          </td></tr>
                        ) : visible.map((r, idx) => {
                          const tt = TYPE_TONES[r.type];
                          const pp = PRIORITY_TONES[r.priority];
                          const ss = STATUS_TONES[r.status];
                          return (
                            <tr key={r.id}>
                              <td className="ps-3 text-center text-muted fs-13">{sliceFrom + idx + 1}</td>
                              <td><span className="rec-id-pill">{r.code || `ANN-${r.id}`}</span></td>
                              <td>
                                <div className="fw-bold fs-13">{r.title}</div>
                                {r.attachment_url && (
                                  <a href={r.attachment_url} target="_blank" rel="noreferrer" className="d-inline-flex align-items-center gap-1 mt-1" style={{ fontSize: 11.5, color: '#0c63b0' }}>
                                    <i className="ri-attachment-line" />{r.attachment_original_name || 'attachment'}
                                  </a>
                                )}
                              </td>
                              <td><span className="rec-pill" style={{ background: tt.bg, color: tt.fg }}>{r.type}</span></td>
                              <td><span className="rec-pill" style={{ background: pp.bg, color: pp.fg }}>{r.priority}</span></td>
                              <td className="fs-13">
                                <AudienceCell row={r} />
                              </td>
                              <td>
                                <span className="rec-pill d-inline-flex align-items-center gap-1" style={{ background: ss.bg, color: ss.fg }}>
                                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: ss.dot }} />
                                  {r.status}
                                </span>
                              </td>
                              <td className="fs-13"><span className="rec-date">{r.publish_at ? formatDate(r.publish_at) : (r.status === 'Draft' ? '—' : formatDate(r.created_at))}</span></td>
                              <td className="fs-13"><span className="rec-date">{formatDate(r.expires_at)}</span></td>
                              <td className="pe-3">
                                <div className="rec-row-actions justify-content-center">
                                  <button type="button" className="rec-act rec-act-view rec-act--icon" title="View / Edit" onClick={() => { setEditingRow(r); setCreateOpen(true); }}>
                                    <i className="ri-eye-line" />
                                  </button>
                                  {r.status === 'Draft' && (
                                    <button type="button" className="rec-act rec-act-approve rec-act--icon" title="Publish Now" onClick={() => handlePublishNow(r)}>
                                      <i className="ri-send-plane-line" />
                                    </button>
                                  )}
                                  <button type="button" className="rec-act rec-act-reject rec-act--icon" title="Delete" onClick={() => handleDelete(r)}>
                                    <i className="ri-delete-bin-line" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="rec-list-footer">
                    <div className="d-flex align-items-center gap-2">
                      <span className="text-muted" style={{ fontSize: 12 }}>Rows per page:</span>
                      <div style={{ width: 80 }}>
                        <MasterSelect value={String(pageSize)} onChange={(v) => { setPageSize(Number(v) || 10); setPage(1); }} options={['10','25','50'].map(v => ({ value: v, label: v }))} placeholder="10" />
                      </div>
                      <span className="text-muted" style={{ fontSize: 12, marginLeft: 16 }}>
                        Showing {filtered.length === 0 ? 0 : (sliceFrom + 1)}–{Math.min(sliceFrom + pageSize, filtered.length)} of {filtered.length}
                      </span>
                    </div>
                    <div className="d-flex align-items-center gap-1">
                      <button className="rec-pagebtn" onClick={() => goto(safePage - 1)} disabled={safePage <= 1}>‹ Prev</button>
                      {Array.from({ length: pageCount }).map((_, i) => (
                        <button key={i} className={`rec-pagebtn${safePage === i + 1 ? ' is-active' : ''}`} onClick={() => goto(i + 1)}>{i + 1}</button>
                      ))}
                      <button className="rec-pagebtn" onClick={() => goto(safePage + 1)} disabled={safePage >= pageCount}>Next ›</button>
                    </div>
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>
        </Col>
      </Row>

      <CreateAnnouncementModal
        isOpen={createOpen}
        editing={editingRow}
        onClose={() => { setCreateOpen(false); setEditingRow(null); }}
        onSaved={handleSaved}
      />
    </>
  );
}

// ── Audience cell — shows a friendly description of the recipient set ───────
function AudienceCell({ row }: { row: AnnRow }) {
  const sub = row.audience_count > 0 ? `${row.audience_count} employee${row.audience_count === 1 ? '' : 's'}` : '0 employees';
  let label = 'All Employees';
  if (row.audience_type === 'roles' && (row.audience_role_ids?.length || 0) > 0) {
    label = `Roles · ${row.audience_role_ids!.length}`;
  } else if (row.audience_type === 'designations' && (row.audience_designation_ids?.length || 0) > 0) {
    label = `Desig · ${row.audience_designation_ids!.length}`;
  }
  return (
    <div>
      <div className="fs-13">{label}</div>
      <div className="text-muted" style={{ fontSize: 11 }}>{sub}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Create / Edit Announcement — 6-step wizard
// ─────────────────────────────────────────────────────────────────────────────

const STEPS: Array<{ key: number; label: string; sub: string }> = [
  { key: 1, label: 'Basic Details',    sub: 'Title, type & priority' },
  { key: 2, label: 'Audience',         sub: 'Who receives this?' },
  { key: 3, label: 'Scheduling',       sub: 'When to publish' },
  { key: 4, label: 'Acknowledgement',  sub: 'Confirmation settings' },
  { key: 5, label: 'Notifications',    sub: 'Delivery channels' },
  { key: 6, label: 'Review & Publish', sub: 'Final confirmation' },
];

function CreateAnnouncementModal({
  isOpen, editing, onClose, onSaved,
}: {
  isOpen: boolean;
  editing: AnnRow | null;
  onClose: () => void;
  onSaved: (row: AnnRow) => void;
}) {
  const toast = useToast();
  const [step, setStep] = useState(1);

  // Step 1
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<AnnType>('General');
  const [priority, setPriority] = useState<AnnPriority>('Normal');
  const [attachment, setAttachment] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Step 2
  const [audienceType, setAudienceType] = useState<AudienceType>('all_employees');
  const [roleIds, setRoleIds]                 = useState<number[]>([]);
  const [designationIds, setDesignationIds]   = useState<number[]>([]);
  const [excludeIds, setExcludeIds]           = useState<number[]>([]);

  // Step 3
  const [publishType, setPublishType] = useState<PublishType>('immediate');
  const [publishAt, setPublishAt]     = useState('');
  const [expiresAt, setExpiresAt]     = useState('');

  // Step 4
  const [ackRequired, setAckRequired] = useState(false);
  const [ackMode, setAckMode]         = useState<AckMode>('Mandatory');
  const [ackFreq, setAckFreq]         = useState<AckFreq>('Weekly');
  const [ackEscalation, setAckEscalation] = useState('3');

  // Step 5 — only Email is exposed to the user. The other channels stay
  // in the schema (and default to false) but the form doesn't surface them.
  const [notifyEmail, setNotifyEmail] = useState(true);

  // Lookups for audience picker
  const [roles, setRoles]                       = useState<Array<{ id: number; name: string }>>([]);
  const [designations, setDesignations]         = useState<Array<{ id: number; name: string }>>([]);
  const [employees, setEmployees]               = useState<Array<{ id: number; display_name: string; emp_code?: string }>>([]);

  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset when opening / when editing row changes
  useEffect(() => {
    if (!isOpen) return;
    setStep(1);
    setErrors({});
    setSaving(false);
    setAttachment(null);

    if (editing) {
      setTitle(editing.title || '');
      setDescription(editing.description || '');
      setType(editing.type || 'General');
      setPriority(editing.priority || 'Normal');
      setAudienceType(editing.audience_type || 'all_employees');
      setRoleIds(editing.audience_role_ids || []);
      setDesignationIds(editing.audience_designation_ids || []);
      setExcludeIds(editing.exclude_employee_ids || []);
      setPublishType(editing.publish_type || 'immediate');
      setPublishAt(editing.publish_at ? toLocalDtInput(editing.publish_at) : '');
      setExpiresAt(editing.expires_at ? toLocalDtInput(editing.expires_at) : '');
      setAckRequired(!!editing.ack_required);
      setAckMode(editing.ack_mode || 'Mandatory');
      setAckFreq(editing.ack_reminder_frequency || 'Weekly');
      setAckEscalation(String(editing.ack_escalation_days ?? 3));
      setNotifyEmail(!!editing.notify_email);
    } else {
      setTitle(''); setDescription('');
      setType('General'); setPriority('Normal');
      setAudienceType('all_employees'); setRoleIds([]); setDesignationIds([]); setExcludeIds([]);
      setPublishType('immediate'); setPublishAt(''); setExpiresAt('');
      setAckRequired(false); setAckMode('Mandatory'); setAckFreq('Weekly'); setAckEscalation('3');
      setNotifyEmail(true);
    }
  }, [isOpen, editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load lookups once when modal opens
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const [rolesRes, desigRes, empRes] = await Promise.all([
          api.get('/master/roles'),
          api.get('/master/designations'),
          api.get('/employees'),
        ]);
        if (cancelled) return;
        const roleRows: any[]  = Array.isArray(rolesRes.data) ? rolesRes.data : [];
        const desigRows: any[] = Array.isArray(desigRes.data) ? desigRes.data : [];
        const empRows: any[]   = Array.isArray(empRes.data)   ? empRes.data   : [];
        const isActive = (r: any) => !r.status || String(r.status).toLowerCase() === 'active';
        setRoles(roleRows.filter(isActive).map(r => ({ id: r.id, name: r.name })));
        setDesignations(desigRows.filter(isActive).map(r => ({ id: r.id, name: r.name })));
        setEmployees(empRows.map(e => ({ id: e.id, display_name: e.display_name || `${e.first_name || ''} ${e.last_name || ''}`.trim() || `Employee #${e.id}`, emp_code: e.emp_code })));
      } catch {
        if (!cancelled) { setRoles([]); setDesignations([]); setEmployees([]); }
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen]);

  // Live audience count — counts the same way the backend will for the
  // recipient subtitle in the preview panel.
  const audienceCount = useMemo(() => {
    if (employees.length === 0) return 0;
    let pool = employees.map(e => e.id);
    if (audienceType === 'roles' || audienceType === 'designations') {
      // We don't have role/designation per employee in this lookup — fall
      // back to a heuristic: 0 if no ids picked, else the picked count.
      const picked = audienceType === 'roles' ? roleIds.length : designationIds.length;
      pool = picked > 0 ? employees.map(e => e.id) : []; // approximate
    }
    if (excludeIds.length > 0) {
      const set = new Set(excludeIds);
      pool = pool.filter(id => !set.has(id));
    }
    return pool.length;
  }, [employees, audienceType, roleIds, designationIds, excludeIds]);

  const validateStep = (s: number): boolean => {
    const e: Record<string, string> = {};
    if (s === 1) {
      if (!title.trim()) e.title = 'Title is required';
      if (!description.trim()) e.description = 'Description is required';
    }
    if (s === 3 && publishType === 'scheduled' && !publishAt) {
      e.publish_at = 'Publish date is required when scheduling for later';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = () => { if (validateStep(step)) setStep(s => Math.min(6, s + 1)); };
  const handleBack = () => setStep(s => Math.max(1, s - 1));

  const buildPayload = (forceStatus?: 'Draft' | null): FormData => {
    const fd = new FormData();
    fd.append('title', title.trim());
    fd.append('description', description);
    fd.append('type', type);
    fd.append('priority', priority);

    fd.append('audience_type', audienceType);
    if (audienceType === 'roles')        roleIds.forEach(id => fd.append('audience_role_ids[]', String(id)));
    if (audienceType === 'designations') designationIds.forEach(id => fd.append('audience_designation_ids[]', String(id)));
    excludeIds.forEach(id => fd.append('exclude_employee_ids[]', String(id)));

    fd.append('publish_type', publishType);
    if (publishAt) fd.append('publish_at', publishAt);
    if (expiresAt) fd.append('expires_at', expiresAt);

    fd.append('ack_required', ackRequired ? '1' : '0');
    fd.append('ack_mode', ackMode);
    fd.append('ack_reminder_frequency', ackFreq);
    fd.append('ack_escalation_days', ackEscalation || '0');

    fd.append('notify_email',    notifyEmail ? '1' : '0');
    // Other channels are disabled in the UI — always send false so a
    // previously-checked value gets cleared on update.
    fd.append('notify_in_app',   '0');
    fd.append('notify_sms',      '0');
    fd.append('notify_whatsapp', '0');

    if (forceStatus === 'Draft') fd.append('status', 'Draft');
    if (attachment) fd.append('attachment', attachment);
    return fd;
  };

  const handleSubmit = async (asDraft: boolean) => {
    if (!asDraft && !validateStep(1)) { setStep(1); return; }
    setSaving(true);
    try {
      const fd = buildPayload(asDraft ? 'Draft' : null);
      const isEdit = editing != null;
      if (isEdit) fd.append('_method', 'PUT');
      const url = isEdit ? `/announcements/${editing!.id}` : '/announcements';
      const { data } = await api.post(url, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success(asDraft ? 'Saved as draft' : (isEdit ? 'Announcement updated' : 'Announcement published'),
        `${data.code || data.id} saved.`);
      onSaved(data);
    } catch (err: any) {
      if (err?.response?.status === 422 && err?.response?.data?.errors) {
        const serverErrs = err.response.data.errors as Record<string, string | string[]>;
        const mapped: Record<string, string> = {};
        for (const k of Object.keys(serverErrs)) {
          const v = serverErrs[k];
          mapped[k] = Array.isArray(v) ? String(v[0]) : String(v);
        }
        setErrors(mapped);
        toast.error('Validation failed', 'Please fix the highlighted fields.');
      } else {
        toast.error('Could not save', err?.response?.data?.message || 'Please try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  // Live preview helpers
  const audienceLabel =
    audienceType === 'all_employees' ? 'All Employees'
    : audienceType === 'roles'        ? `Roles: ${roleIds.length === 0 ? '—' : roles.filter(r => roleIds.includes(r.id)).map(r => r.name).join(', ')}`
                                       : `Desig: ${designationIds.length === 0 ? '—' : designations.filter(d => designationIds.includes(d.id)).map(d => d.name).join(', ')}`;

  return (
    <Modal isOpen={isOpen} toggle={onClose} centered size="xl" backdrop="static" keyboard={false} contentClassName="border-0">
      <ModalBody className="p-0" style={{ background: 'var(--vz-card-bg)', borderRadius: 18, overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '14px 20px', background: 'linear-gradient(135deg, #0ea5e9 0%, #38bdf8 60%, #7dd3fc 100%)' }}>
          <div className="d-flex align-items-center justify-content-between gap-3">
            <div className="d-flex align-items-center gap-2">
              <span style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.18)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <i className="ri-send-plane-line" style={{ fontSize: 18, color: '#fff' }} />
              </span>
              <div>
                <h5 className="fw-bold mb-0" style={{ color: '#fff', fontSize: 16, lineHeight: 1.2 }}>{editing ? 'Edit Announcement' : 'Create Announcement'}</h5>
                <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.85)' }}>Manage company-wide communications and notifications</div>
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'rgba(255,255,255,0.18)', border: 0, color: '#fff', borderRadius: 8, width: 32, height: 32 }}>
              <i className="ri-close-line" style={{ fontSize: 18 }} />
            </button>
          </div>
        </div>

        {/* Step indicator */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb', overflowX: 'auto' }}>
          <div className="d-flex align-items-center" style={{ gap: 16, flexWrap: 'nowrap' }}>
            {STEPS.map(s => {
              const active = step === s.key;
              const done = step > s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => { if (done || active) setStep(s.key); }}
                  disabled={!done && !active}
                  className="d-inline-flex align-items-center"
                  style={{
                    gap: 8, padding: '4px 8px', border: 0, background: 'transparent',
                    color: active ? '#0c63b0' : (done ? '#0ea5e9' : '#9ca3af'),
                    cursor: (done || active) ? 'pointer' : 'default', flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      width: 26, height: 26, borderRadius: '50%',
                      background: active ? '#0c63b0' : (done ? '#0ea5e9' : '#e5e7eb'),
                      color: (active || done) ? '#fff' : '#6b7280',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 700,
                    }}
                  >
                    {done ? <i className="ri-check-line" /> : s.key}
                  </span>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.1 }}>{s.label}</div>
                    <div style={{ fontSize: 10.5, opacity: 0.75 }}>{s.sub}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Body — split: form left, live preview right */}
        <div className="d-flex" style={{ minHeight: 360 }}>
          <div style={{ flex: '1 1 0', padding: 20, overflowY: 'auto', maxHeight: '70vh' }}>
            {step === 1 && (
              <Step1Basic
                title={title} setTitle={setTitle}
                description={description} setDescription={setDescription}
                type={type} setType={setType}
                priority={priority} setPriority={setPriority}
                attachment={attachment} setAttachment={setAttachment}
                fileRef={fileRef}
                errors={errors}
              />
            )}
            {step === 2 && (
              <Step2Audience
                audienceType={audienceType} setAudienceType={setAudienceType}
                roles={roles} roleIds={roleIds} setRoleIds={setRoleIds}
                designations={designations} designationIds={designationIds} setDesignationIds={setDesignationIds}
                employees={employees} excludeIds={excludeIds} setExcludeIds={setExcludeIds}
                audienceCount={audienceCount}
              />
            )}
            {step === 3 && (
              <Step3Schedule
                publishType={publishType} setPublishType={setPublishType}
                publishAt={publishAt} setPublishAt={setPublishAt}
                expiresAt={expiresAt} setExpiresAt={setExpiresAt}
                errors={errors}
              />
            )}
            {step === 4 && (
              <Step4Ack
                ackRequired={ackRequired} setAckRequired={setAckRequired}
                ackMode={ackMode} setAckMode={setAckMode}
                ackFreq={ackFreq} setAckFreq={setAckFreq}
                ackEscalation={ackEscalation} setAckEscalation={setAckEscalation}
              />
            )}
            {step === 5 && (
              <Step5Notify
                notifyEmail={notifyEmail} setNotifyEmail={setNotifyEmail}
              />
            )}
            {step === 6 && (
              <Step6Review
                title={title} description={description} type={type} priority={priority}
                audienceLabel={audienceLabel} audienceCount={audienceCount}
                publishType={publishType} publishAt={publishAt} expiresAt={expiresAt}
                ackRequired={ackRequired} ackMode={ackMode}
                notifyEmail={notifyEmail}
                editing={editing}
              />
            )}
          </div>

          {/* Live preview — sits on the right of every step */}
          <div style={{ flex: '0 0 320px', borderLeft: '1px solid #e5e7eb', padding: 16, background: '#fafafa', maxHeight: '70vh', overflowY: 'auto' }}>
            <div className="text-uppercase fw-semibold mb-2" style={{ fontSize: 10.5, letterSpacing: '0.06em', color: '#6b7280' }}>Live Preview</div>
            <div style={{ background: '#e0f2fe', borderRadius: 12, padding: 14, marginBottom: 12 }}>
              <div className="d-flex align-items-center justify-content-between mb-2">
                <i className="ri-send-plane-line" style={{ fontSize: 22, color: '#0284c7' }} />
              </div>
              <div className="fw-bold" style={{ fontSize: 14 }}>{title || 'Announcement Title'}</div>
              <div style={{ fontSize: 12, color: '#475569', minHeight: 18 }}>{description || 'Description appears here…'}</div>
              <div className="d-flex align-items-center justify-content-between mt-2">
                <span style={{ fontSize: 11, color: '#0c63b0' }}>{audienceLabel}</span>
                <span className="rec-pill" style={{ background: TYPE_TONES[type].bg, color: TYPE_TONES[type].fg, fontSize: 10.5 }}>{type}</span>
              </div>
            </div>
            <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10, padding: 12, fontSize: 12.5, color: '#0c4a6e' }}>
              <div><strong>Status:</strong> {editing?.status || (publishType === 'scheduled' ? 'Scheduled' : 'Draft')}</div>
              <div><strong>Priority:</strong> {priority}</div>
              <div><strong>Audience:</strong> {audienceLabel.replace(/^(Roles|Desig): /, '')} ({audienceCount})</div>
              <div><strong>Publish:</strong> {publishType === 'scheduled' && publishAt ? formatDateTime(publishAt) : 'Immediately'}</div>
              <div><strong>Expiry:</strong> {expiresAt ? formatDateTime(expiresAt) : '—'}</div>
              <div><strong>Ack:</strong> {ackRequired ? ackMode : 'No'}</div>
              <div><strong>Notify:</strong> {notifyEmail ? 'Email' : '—'}</div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid #e5e7eb', background: '#fafafa', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="text-muted" style={{ fontSize: 12 }}>Step {step} of 6</span>
          <div className="d-flex gap-2">
            <button type="button" className="rec-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            {step > 1 && (
              <button type="button" className="rec-btn-ghost" onClick={handleBack} disabled={saving}>
                <i className="ri-arrow-left-line" />Back
              </button>
            )}
            <button type="button" className="rec-btn-ghost" onClick={() => handleSubmit(true)} disabled={saving}>
              {saving ? <Spinner size="sm" /> : <i className="ri-save-3-line" />}Save Draft
            </button>
            {step < 6 ? (
              <button type="button" className="rec-btn-primary" onClick={handleNext} disabled={saving}>
                Save & Next<i className="ri-arrow-right-line" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleSubmit(false)}
                disabled={saving}
                style={{
                  padding: '8px 18px', borderRadius: 10, border: 0,
                  background: 'linear-gradient(135deg, #047857 0%, #10b981 100%)',
                  color: '#fff', fontSize: 13, fontWeight: 700,
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                {saving ? <Spinner size="sm" /> : <i className="ri-send-plane-line" />}Publish
              </button>
            )}
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
}

// ── Step 1 — Basic Details ──────────────────────────────────────────────────
function Step1Basic({
  title, setTitle, description, setDescription,
  type, setType, priority, setPriority,
  attachment, setAttachment, fileRef, errors,
}: any) {
  return (
    <>
      <div className="text-uppercase fw-semibold mb-3" style={{ color: '#0c63b0' }}>
        <i className="ri-checkbox-blank-line" /> Basic Details
      </div>
      <div className="mb-3">
        <label className="rec-form-label">Announcement Title<span className="req">*</span></label>
        <input type="text" className={`rec-input${errors.title ? ' is-invalid' : ''}`} placeholder="Enter a clear, concise title…" value={title} onChange={e => setTitle(e.target.value)} />
        {errors.title && <div className="rec-error"><i className="ri-error-warning-line" />{errors.title}</div>}
      </div>
      <div className="mb-3">
        <label className="rec-form-label">Description<span className="req">*</span></label>
        <textarea rows={5} className={`rec-input rec-textarea${errors.description ? ' is-invalid' : ''}`} placeholder="Describe this announcement in detail…" value={description} onChange={e => setDescription(e.target.value)} />
        {errors.description && <div className="rec-error"><i className="ri-error-warning-line" />{errors.description}</div>}
      </div>
      <Row className="g-3">
        <Col md={6}>
          <label className="rec-form-label">Type</label>
          <div className="d-flex gap-2 flex-wrap">
            {(['General','Policy','Urgent'] as AnnType[]).map(v => (
              <button key={v} type="button" onClick={() => setType(v)} className="rec-priority-pill" style={{
                background: type === v ? TYPE_TONES[v].bg : '#fff',
                color: type === v ? TYPE_TONES[v].fg : '#475569',
                border: type === v ? `1px solid ${TYPE_TONES[v].fg}` : '1px solid #e5e7eb',
              }}>{v}</button>
            ))}
          </div>
        </Col>
        <Col md={6}>
          <label className="rec-form-label">Priority<span className="req">*</span></label>
          <div className="d-flex gap-2 flex-wrap">
            {(['Normal','High','Critical'] as AnnPriority[]).map(v => (
              <button key={v} type="button" onClick={() => setPriority(v)} className="rec-priority-pill" style={{
                background: priority === v ? PRIORITY_TONES[v].bg : '#fff',
                color: priority === v ? PRIORITY_TONES[v].fg : '#475569',
                border: priority === v ? `1px solid ${PRIORITY_TONES[v].fg}` : '1px solid #e5e7eb',
              }}>{v}</button>
            ))}
          </div>
        </Col>
      </Row>
      <div className="mt-3">
        <label className="rec-form-label">Attachment (Optional)</label>
        <div
          onClick={() => fileRef.current?.click()}
          style={{
            border: '1px dashed #c7d2fe', borderRadius: 10,
            padding: '20px', textAlign: 'center', cursor: 'pointer',
            background: attachment ? '#eef2ff' : '#fafafa',
          }}
        >
          <i className="ri-upload-cloud-line" style={{ fontSize: 24, color: '#6366f1' }} />
          <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>
            {attachment ? attachment.name : 'Click to upload (PNG, JPG, PDF · max 20MB)'}
          </div>
          {!attachment && <div style={{ fontSize: 11, color: '#6b7280' }}>or drag and drop here</div>}
          <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.pdf" style={{ display: 'none' }} onChange={e => setAttachment(e.target.files?.[0] ?? null)} />
        </div>
      </div>
    </>
  );
}

// ── Step 2 — Audience ───────────────────────────────────────────────────────
function Step2Audience({
  audienceType, setAudienceType,
  roles, roleIds, setRoleIds,
  designations, designationIds, setDesignationIds,
  employees, excludeIds, setExcludeIds,
}: any) {
  // Total tenant headcount drives the All-Employees banner — the picked
  // role/designation case shows its own picker count instead.
  const totalEmps = employees.length;

  return (
    <>
      <div className="text-uppercase fw-semibold mb-3" style={{ color: '#0c63b0' }}>
        <i className="ri-user-line" /> Audience Selection
      </div>
      <div className="mb-3">
        <label className="rec-form-label">Target Audience<span className="req">*</span></label>
        <div className="d-flex gap-2 flex-wrap">
          {([
            { key: 'all_employees', label: 'All Employees' },
            { key: 'roles',         label: 'Role-Based' },
            { key: 'designations',  label: 'Designation-Based' },
          ] as { key: AudienceType; label: string }[]).map(o => {
            const active = audienceType === o.key;
            return (
              <button key={o.key} type="button" onClick={() => setAudienceType(o.key)} className="rec-priority-pill" style={{
                background: active ? '#e0f2fe' : '#fff',
                color: active ? '#0c63b0' : '#475569',
                border: active ? '1px solid #0c63b0' : '1px solid #e5e7eb',
              }}>{o.label}</button>
            );
          })}
        </div>
      </div>

      {/* All Employees → green delivered banner + tiny "x selected" chip. */}
      {audienceType === 'all_employees' && (
        <>
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '12px 16px', marginBottom: 10, color: '#15803d', fontSize: 13 }}>
            <i className="ri-checkbox-circle-line me-1" /> Announcement delivered to all <strong>{totalEmps}</strong> employee{totalEmps === 1 ? '' : 's'}.
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 18, background: '#ecfeff', color: '#0e7490', fontSize: 12.5, fontWeight: 600, border: '1px solid #a5f3fc', marginBottom: 14 }}>
            <i className="ri-user-line" /> {totalEmps} employees selected
          </span>
        </>
      )}

      {/* Role-Based → bordered card with an inline checkbox per role. */}
      {audienceType === 'roles' && (
        <div className="mb-3">
          <label className="rec-form-label">SELECT ROLES<span className="req">*</span></label>
          <CheckboxBox
            options={roles.map((r: any) => ({ id: r.id, label: r.name }))}
            selected={roleIds}
            onChange={setRoleIds}
            empty="No roles configured in Master → Roles"
          />
        </div>
      )}

      {/* Designation-Based → same checkbox card, sourced from designations. */}
      {audienceType === 'designations' && (
        <div className="mb-3">
          <label className="rec-form-label">SELECT DESIGNATIONS<span className="req">*</span></label>
          <CheckboxBox
            options={designations.map((d: any) => ({ id: d.id, label: d.name }))}
            selected={designationIds}
            onChange={setDesignationIds}
            empty="No designations configured in Master → Designations"
          />
        </div>
      )}

      {/* Exclude is shown for every audience type — it's how the user
          carves individuals out of the otherwise-matching set. */}
      <div>
        <label className="rec-form-label">EXCLUDE (OPTIONAL)</label>
        <MultiPicker
          options={employees.map((e: any) => ({ id: e.id, label: `${e.display_name}${e.emp_code ? ' · ' + e.emp_code : ''}` }))}
          selected={excludeIds}
          onChange={setExcludeIds}
          placeholder="Names or departments to exclude…"
        />
      </div>
    </>
  );
}

// Inline checkbox grid wrapped in a single bordered card. Used by the
// Role-Based / Designation-Based audience pickers — short option lists
// where seeing every choice at once beats opening a dropdown.
function CheckboxBox({ options, selected, onChange, empty }: {
  options: { id: number; label: string }[];
  selected: number[];
  onChange: (ids: number[]) => void;
  empty?: string;
}) {
  if (options.length === 0) {
    return (
      <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 10, color: '#9ca3af', fontSize: 13, textAlign: 'center' }}>
        {empty || 'No options available'}
      </div>
    );
  }
  const toggle = (id: number) => {
    if (selected.includes(id)) onChange(selected.filter(x => x !== id));
    else onChange([...selected, id]);
  };
  return (
    <div style={{ padding: 14, border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff' }}>
      <div className="d-flex flex-wrap" style={{ gap: 10 }}>
        {options.map(o => {
          const active = selected.includes(o.id);
          return (
            <label
              key={o.id}
              className="d-inline-flex align-items-center"
              style={{
                gap: 6, padding: '6px 12px', borderRadius: 8,
                background: active ? '#e0f2fe' : '#fff',
                border: active ? '1px solid #0c63b0' : '1px solid #e5e7eb',
                cursor: 'pointer', fontSize: 13, userSelect: 'none',
              }}
            >
              <input type="checkbox" checked={active} onChange={() => toggle(o.id)} />
              {o.label}
            </label>
          );
        })}
      </div>
    </div>
  );
}

// Lightweight multi-select with chips. Used by Step 2.
function MultiPicker({ options, selected, onChange, placeholder }: {
  options: { id: number; label: string }[]; selected: number[]; onChange: (ids: number[]) => void; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const n = search.trim().toLowerCase();
    return options.filter(o => !n || o.label.toLowerCase().includes(n));
  }, [options, search]);
  const toggle = (id: number) => {
    if (selected.includes(id)) onChange(selected.filter(x => x !== id));
    else onChange([...selected, id]);
  };
  return (
    <div style={{ position: 'relative' }}>
      <div
        onClick={() => setOpen(o => !o)}
        className="rec-input"
        style={{ minHeight: 38, cursor: 'pointer', display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', padding: '6px 10px' }}
      >
        {selected.length === 0 && <span style={{ color: '#9ca3af', fontSize: 13 }}>{placeholder || 'Select…'}</span>}
        {selected.slice(0, 4).map(id => {
          const o = options.find(x => x.id === id);
          if (!o) return null;
          return (
            <span key={id} className="rec-pill" style={{ background: '#e0f2fe', color: '#0c63b0', fontSize: 11.5 }}>
              {o.label}
              <i className="ri-close-line ms-1" onClick={(e) => { e.stopPropagation(); toggle(id); }} style={{ cursor: 'pointer' }} />
            </span>
          );
        })}
        {selected.length > 4 && <span className="text-muted" style={{ fontSize: 11.5 }}>+{selected.length - 4} more</span>}
      </div>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.10)', zIndex: 10, maxHeight: 240, overflowY: 'auto' }}>
          <div style={{ padding: 8, borderBottom: '1px solid #e5e7eb' }}>
            <input className="rec-input" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} autoFocus />
          </div>
          {filtered.length === 0 ? (
            <div className="text-muted text-center py-3" style={{ fontSize: 12 }}>No matches</div>
          ) : filtered.map(o => (
            <div key={o.id} onClick={() => toggle(o.id)}
              style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}
            >
              <input type="checkbox" readOnly checked={selected.includes(o.id)} />
              <span>{o.label}</span>
            </div>
          ))}
          <div style={{ padding: 8, borderTop: '1px solid #e5e7eb', textAlign: 'right' }}>
            <button type="button" className="rec-btn-ghost" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Step 3 — Scheduling ─────────────────────────────────────────────────────
function Step3Schedule({ publishType, setPublishType, publishAt, setPublishAt, expiresAt, setExpiresAt, errors }: any) {
  return (
    <>
      <div className="text-uppercase fw-semibold mb-3" style={{ color: '#0c63b0' }}>
        <i className="ri-calendar-line" /> Scheduling
      </div>
      <div className="mb-3">
        <label className="rec-form-label">Publish Type<span className="req">*</span></label>
        <div className="d-flex gap-2 flex-wrap">
          {([
            { key: 'immediate', label: 'Publish Immediately', icon: 'ri-flashlight-line' },
            { key: 'scheduled', label: 'Schedule for Later',  icon: 'ri-calendar-line' },
          ] as { key: PublishType; label: string; icon: string }[]).map(o => {
            const active = publishType === o.key;
            return (
              <button key={o.key} type="button" onClick={() => setPublishType(o.key)} className="rec-priority-pill" style={{
                background: active ? '#e0f2fe' : '#fff',
                color: active ? '#0c63b0' : '#475569',
                border: active ? '1px solid #0c63b0' : '1px solid #e5e7eb',
              }}>
                <i className={o.icon + ' me-1'} />{o.label}
              </button>
            );
          })}
        </div>
      </div>

      {publishType === 'scheduled' && (
        <div className="mb-3" style={{ maxWidth: 360 }}>
          <label className="rec-form-label">Publish On<span className="req">*</span></label>
          <DateTimeField value={publishAt} onChange={setPublishAt} invalid={!!errors.publish_at} />
          {errors.publish_at && <div className="rec-error"><i className="ri-error-warning-line" />{errors.publish_at}</div>}
        </div>
      )}

      <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10, padding: 12, marginBottom: 12, color: '#0c4a6e', fontSize: 13 }}>
        <i className="ri-flashlight-line" /> {publishType === 'scheduled'
          ? 'This announcement will go live at the scheduled date/time.'
          : 'This announcement will go live immediately upon final publish.'}
      </div>

      <div style={{ maxWidth: 360 }}>
        <label className="rec-form-label">Active Until — Expiry Date<span className="req">*</span></label>
        <DateTimeField value={expiresAt} onChange={setExpiresAt} />
      </div>
    </>
  );
}


function DateTimeField({ value, onChange, invalid }: {
  value: string; onChange: (v: string) => void; invalid?: boolean;
}) {
  // Split the bound datetime-local string into its date / time halves so the
  // two pickers can edit them independently. Re-combine on every change.
  const datePart = value && value.length >= 10 ? value.slice(0, 10) : '';
  const timePart = value && value.length >= 16 ? value.slice(11, 16) : '';

  const setDate = (d: string) => {
    if (!d) { onChange(''); return; }
    onChange(`${d}T${timePart || '09:00'}`);
  };
  const setTime = (t: string) => {
    // If no date picked yet, default to today so the user isn't blocked
    // when they pick the time first.
    const d = datePart || new Date().toISOString().slice(0, 10);
    onChange(`${d}T${t}`);
  };

  return (
    <div className="d-flex" style={{ gap: 6 }}>
      <div style={{ flex: '1 1 0', minWidth: 0 }}>
        <MasterDatePicker value={datePart} onChange={setDate} placeholder="Select date" invalid={invalid} />
      </div>
      <div style={{ width: 110, flexShrink: 0 }}>
        <MasterTimePicker value={timePart} onChange={setTime} />
      </div>
    </div>
  );
}

/* ── MasterTimePicker ────────────────────────────────────────────────────────
 * A pop-over time picker styled to match MasterDatePicker — same toggle
 * height/border/focus-ring, same popup-card chrome, same gradient on the
 * selected cell. Two scrollable columns (hours 0–23, minutes in 5-min steps)
 * so it stays compact next to the calendar.
 */
function MasterTimePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  // Portal-positioned popup, same pattern MasterDatePicker uses — keeps the
  // popup out of the modal's overflow:auto scroll container so it can't get
  // clipped behind the footer.
  const [popupPos, setPopupPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // Parse "HH:MM" into numeric h/m. -1 sentinel means "nothing picked yet"
  // so the popup doesn't pre-highlight a default we never committed.
  const parts = value && /^\d{1,2}:\d{1,2}$/.test(value) ? value.split(':').map(Number) : [-1, -1];
  const h = parts[0]!;
  const m = parts[1]!;

  // Compute popup position from the toggle's bounding rect on every open;
  // also re-compute on resize so a window-resize while open doesn't strand
  // the popup. Aligns the popup's right edge with the toggle so a 200-px
  // popup doesn't overflow the right side of a narrow modal slot.
  useEffect(() => {
    if (!open || !wrapRef.current) { setPopupPos(null); return; }
    const update = () => {
      if (!wrapRef.current) return;
      const rect = wrapRef.current.getBoundingClientRect();
      const popupWidth = 200;
      // Right-align by default; clamp so the popup never leaks off the
      // viewport edge when the toggle sits near the right.
      const right = rect.right;
      const left = Math.max(8, right - popupWidth);
      setPopupPos({ top: rect.bottom + 5, left, width: popupWidth });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [open]);

  // Close on outside click, Esc, and any ancestor scroll (so the portalled
  // popup doesn't float in a stale position when the modal body scrolls).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const inWrap = wrapRef.current?.contains(target);
      const inPopup = popupRef.current?.contains(target);
      if (!inWrap && !inPopup) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const pad2 = (n: number) => String(n).padStart(2, '0');
  const setHour = (newH: number) => {
    const newM = m >= 0 ? m : 0;
    onChange(`${pad2(newH)}:${pad2(newM)}`);
  };
  const setMinute = (newM: number) => {
    const newH = h >= 0 ? h : 9;
    onChange(`${pad2(newH)}:${pad2(newM)}`);
  };

  const display = (h >= 0 && m >= 0) ? `${pad2(h)}:${pad2(m)}` : '';

  // Selected-cell gradient mirrors the date picker's accent.
  const cellSelectedBg = 'linear-gradient(135deg,#6366f1 0%,#818cf8 100%)';

  return (
    <div ref={wrapRef} className="master-datepicker-wrap" style={{ position: 'relative', width: '100%' }}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); } }}
        className={`master-datepicker-toggle${open ? ' open' : ''}`}
      >
        <span className={display ? 'master-datepicker-value' : 'master-datepicker-placeholder'}>
          {display || 'HH:MM'}
        </span>
        <i className="ri-time-line master-datepicker-icon" />
      </div>
      {open && popupPos && createPortal(
        <div
          ref={popupRef}
          className="master-datepicker-popup"
          // Override the .master-datepicker-popup defaults (which assume
          // absolute-to-wrapper positioning) so the portalled element shows
          // up at the viewport coords we computed above.
          style={{
            position: 'fixed',
            top: popupPos.top,
            left: popupPos.left,
            minWidth: popupPos.width,
            maxWidth: popupPos.width,
            padding: 10,
          }}
        >
          <div style={{ display: 'flex', gap: 6 }}>
            <TimeColumn label="Hr"  count={24} step={1} selected={h} onPick={setHour}   selectedBg={cellSelectedBg} />
            <TimeColumn label="Min" count={12} step={5} selected={m} onPick={setMinute} selectedBg={cellSelectedBg} />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function TimeColumn({ label, count, step, selected, onPick, selectedBg }: {
  label: string; count: number; step: number; selected: number; onPick: (v: number) => void; selectedBg: string;
}) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{
        textAlign: 'center', fontSize: 10.5, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.06em',
        color: '#6b7280', padding: '4px 0 6px',
      }}>{label}</div>
      <div style={{ maxHeight: 170, overflowY: 'auto', paddingRight: 2 }}>
        {Array.from({ length: count }).map((_, i) => {
          const v = i * step;
          const active = selected === v;
          return (
            <div
              key={v}
              role="button"
              tabIndex={0}
              onClick={() => onPick(v)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(v); } }}
              style={{
                padding: '6px 0', textAlign: 'center', fontSize: 12.5, fontWeight: 600,
                borderRadius: 6, cursor: 'pointer', userSelect: 'none',
                background: active ? selectedBg : 'transparent',
                color: active ? '#fff' : '#475569',
                marginBottom: 2,
              }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = '#eef2ff'; }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
            >
              {String(v).padStart(2, '0')}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Step 4 — Acknowledgement ────────────────────────────────────────────────
function Step4Ack({ ackRequired, setAckRequired, ackMode, setAckMode, ackFreq, setAckFreq, ackEscalation, setAckEscalation }: any) {
  return (
    <>
      <div className="text-uppercase fw-semibold mb-3" style={{ color: '#0c63b0' }}>
        <i className="ri-checkbox-line" /> Acknowledgement Settings
      </div>
      <label className="d-flex align-items-start gap-2 p-3 mb-3" style={{ border: ackRequired ? '1px solid #0c63b0' : '1px solid #e5e7eb', borderRadius: 10, cursor: 'pointer', background: ackRequired ? '#e0f2fe' : '#fff' }}>
        <input type="checkbox" checked={ackRequired} onChange={e => setAckRequired(e.target.checked)} />
        <div>
          <div className="fw-bold">Require Employee Acknowledgement</div>
          <div className="text-muted" style={{ fontSize: 12 }}>Employees must confirm they've read this announcement</div>
        </div>
      </label>

      {ackRequired && (
        <>
          <Row className="g-3 mb-3">
            <Col md={4}>
              <label className="rec-form-label">Mode<span className="req">*</span></label>
              <MasterSelect value={ackMode} onChange={(v) => setAckMode(v as AckMode)} options={[{ value: 'Mandatory', label: 'Mandatory' }, { value: 'Optional', label: 'Optional' }]} placeholder="Mandatory" />
            </Col>
            <Col md={4}>
              <label className="rec-form-label">Reminder Frequency<span className="req">*</span></label>
              <MasterSelect value={ackFreq} onChange={(v) => setAckFreq(v as AckFreq)} options={[{ value: 'Daily', label: 'Daily' }, { value: 'Weekly', label: 'Weekly' }, { value: 'Never', label: 'Never' }]} placeholder="Weekly" />
            </Col>
            <Col md={4}>
              <label className="rec-form-label">Escalation Days<span className="req">*</span></label>
              <input type="number" min={0} className="rec-input" value={ackEscalation} onChange={e => setAckEscalation(e.target.value)} />
            </Col>
          </Row>
          <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10, padding: 12, color: '#0c4a6e', fontSize: 13 }}>
            <i className="ri-information-line" /> Manager is notified after the set days if the employee hasn't acknowledged.
          </div>
        </>
      )}
    </>
  );
}

// ── Step 5 — Notifications ──────────────────────────────────────────────────
function Step5Notify({ notifyEmail, setNotifyEmail }: { notifyEmail: boolean; setNotifyEmail: (v: boolean) => void }) {
  return (
    <>
      <div className="d-flex align-items-center gap-2 mb-3" style={{ color: '#0c63b0' }}>
        <i className="ri-notification-3-line" />
        <span className="fw-semibold" style={{ fontSize: 14 }}>Notification Channels</span>
      </div>
      <hr className="mt-1 mb-3" style={{ borderColor: '#e5e7eb' }} />

      {/* Single full-width email card — checkbox + icon + title + subtitle.
          Border + tinted background swap when the channel is enabled so it
          reads as a clear "selected / not selected" pair. */}
      <label
        className="d-flex align-items-center gap-3 p-3 mb-3"
        style={{
          border: notifyEmail ? '1.5px solid #0ea5e9' : '1px solid #e5e7eb',
          borderRadius: 10, cursor: 'pointer',
          background: notifyEmail ? '#f0f9ff' : '#fff',
          boxShadow: notifyEmail ? '0 0 0 3px rgba(14,165,233,0.10)' : 'none',
          transition: 'border-color .15s ease, background .15s ease, box-shadow .15s ease',
        }}
      >
        <input
          type="checkbox"
          checked={notifyEmail}
          onChange={e => setNotifyEmail(e.target.checked)}
          style={{ width: 18, height: 18, accentColor: '#0ea5e9', cursor: 'pointer' }}
        />
        <i className="ri-mail-line" style={{ fontSize: 18, color: notifyEmail ? '#0ea5e9' : '#6b7280' }} />
        <div className="d-flex flex-column">
          <span className="fw-bold" style={{ fontSize: 14, color: '#111827' }}>Email Notification</span>
          <span style={{ fontSize: 12, color: '#6b7280' }}>Send directly to each employee's inbox</span>
        </div>
      </label>

      {/* Soft footnote — explains that the channel is optional since the
          announcement still shows in the in-app list regardless. */}
      <div
        style={{
          background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 10,
          padding: '10px 14px', color: '#475569', fontSize: 12.5,
        }}
      >
        Email notification is optional. The announcement will still be visible in the system regardless.
      </div>
    </>
  );
}

// ── Step 6 — Review & Publish ───────────────────────────────────────────────
function Step6Review({
  title, description, type, priority,
  audienceLabel, audienceCount,
  publishType, publishAt, expiresAt,
  ackRequired, ackMode,
  notifyEmail,
  editing,
}: any) {
  const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div style={{ background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 12px' }}>
      <div className="text-uppercase fw-semibold" style={{ fontSize: 10, letterSpacing: '0.05em', color: '#6b7280' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{value || <span className="text-muted">—</span>}</div>
    </div>
  );
  return (
    <>
      <div className="text-uppercase fw-semibold mb-3" style={{ color: '#0c63b0' }}>
        <i className="ri-file-text-line" /> Review & Publish
      </div>
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <div className="fw-bold" style={{ fontSize: 16 }}>{title || '—'}</div>
        <div className="text-muted mb-3" style={{ fontSize: 13 }}>{description || '—'}</div>
        <Row className="g-2">
          <Col md={3}><Field label="Type" value={type} /></Col>
          <Col md={3}><Field label="Priority" value={priority} /></Col>
          <Col md={3}><Field label="Audience" value={audienceLabel} /></Col>
          <Col md={3}><Field label="Count" value={`${audienceCount} employees`} /></Col>
          <Col md={3}><Field label="Publish" value={publishType === 'scheduled' && publishAt ? formatDateTime(publishAt) : 'Immediately'} /></Col>
          <Col md={3}><Field label="Expires" value={expiresAt ? formatDateTime(expiresAt) : '—'} /></Col>
          <Col md={3}><Field label="Ack" value={ackRequired ? ackMode : 'No'} /></Col>
          <Col md={3}><Field label="Notify" value={notifyEmail ? 'Email' : '—'} /></Col>
        </Row>
      </div>
      {editing && (
        <div className="text-muted" style={{ fontSize: 12 }}>
          Editing <strong>{editing.code}</strong> · created {formatDateTime(editing.created_at)}
          {editing.creator?.name ? <> by {editing.creator.name}</> : null}
        </div>
      )}
      <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10, padding: 12, color: '#0c4a6e', fontSize: 13, marginTop: 12 }}>
        <i className="ri-information-line" /> Clicking <strong>Publish</strong> will make this announcement live immediately.
      </div>
    </>
  );
}

// Helper: convert ISO datetime to value accepted by <input type="datetime-local">.
function toLocalDtInput(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
