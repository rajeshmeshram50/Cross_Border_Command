import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardBody, Col, Row, Modal, ModalBody, Spinner, Input } from 'reactstrap';
import { MasterSelect, MasterFormStyles } from '../master/masterFormKit';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import api from '../../api';
import { ShimmerTableRows } from '../../components/ui/Shimmer';
import Tooltip from '../../components/ui/Tooltip';
import WorklistPager from '../../components/ui/WorklistPager';
import '../../../css/recruitment.css';

// ── Types ────────────────────────────────────────────────────────────────────
type AnnType    = 'General' | 'Policy' | 'Urgent';
type AnnPriority = 'Normal' | 'High' | 'Critical';
type AnnStatus  = 'Draft' | 'Scheduled' | 'Active' | 'Expired' | 'Archived';
type AudienceType = 'all_employees' | 'roles' | 'designations';

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
  // Legacy lifecycle fields kept on the API row for back-compat with the
  // list view's date columns. The wizard no longer surfaces scheduling or
  // acknowledgement controls — every publish is immediate.
  publish_type: 'immediate' | 'scheduled';
  publish_at: string | null;
  expires_at: string | null;
  ack_required: boolean;
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
const STATUS_TONES: Record<AnnStatus, { bg: string; fg: string }> = {
  Draft:     { bg: '#f3f4f6', fg: '#4b5563' },
  Scheduled: { bg: '#fef3c7', fg: '#92400e' },
  Active:    { bg: '#dcfce7', fg: '#15803d' },
  Expired:   { bg: '#fee2e2', fg: '#b91c1c' },
  Archived:  { bg: '#e0e7ff', fg: '#4338ca' },
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
  const confirmDialog = useConfirm();

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
  // Row currently being published — drives the inline spinner so the user gets
  // instant feedback the moment they click Publish Now.
  const [publishingId, setPublishingId] = useState<number | null>(null);

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

  // High-priority count isn't in the /stats payload (which is grouped by
  // status), so derive it from the loaded list — rows holds every
  // announcement (the table paginates client-side), so it's accurate.
  const highPriorityCount = useMemo(() => rows.filter(r => r.priority === 'High').length, [rows]);

  // Same KPI shape the recruitment page uses — gradient on the top
  // accent strip + gradient on the icon tile + deep tone on the number.
  // Looks consistent with the rest of the HR module.
  const KPI_CARDS = [
    { label: 'Total',         value: stats.total,       icon: 'ri-send-plane-fill',     gradient: 'linear-gradient(135deg,#299cdb 0%,#4dabf7 100%)', deep: '#1e6dd6' },
    { label: 'Draft',         value: stats.draft,       icon: 'ri-draft-line',          gradient: 'linear-gradient(135deg,#878a99 0%,#a3a6b4 100%)', deep: '#5b6478' },
    { label: 'Published',     value: stats.active,      icon: 'ri-checkbox-circle-fill',gradient: 'linear-gradient(135deg,#0ab39c 0%,#22c8a9 100%)', deep: '#089d7a' },
    { label: 'High Priority', value: highPriorityCount, icon: 'ri-fire-fill',           gradient: 'linear-gradient(135deg,#f06548 0%,#fb9b85 100%)', deep: '#c2410c' },
  ];

  // Merge a saved row into the list (insert new / replace existing) + refresh
  // stats. Shared by the close-on-save (Publish) and keep-open (Save Draft) paths.
  const mergeSavedRow = (saved: AnnRow) => {
    setRows(prev => {
      const idx = prev.findIndex(r => r.id === saved.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = saved; return next; }
      return [saved, ...prev];
    });
    fetchAll(); // refresh stats too
  };

  const handleSaved = (saved: AnnRow) => {
    mergeSavedRow(saved);
    setCreateOpen(false);
    setEditingRow(null);
  };

  // Save Draft path — persist to the list/stats but KEEP the modal open so the
  // user can keep editing. The modal tracks the saved id internally so further
  // saves update the same record rather than creating duplicate drafts.
  const handleSilentSave = (saved: AnnRow) => {
    mergeSavedRow(saved);
  };

  const handleDelete = async (row: AnnRow) => {
    const ok = await confirmDialog({
      title: 'Delete announcement',
      message: <>Delete announcement <strong>{row.code}</strong>? This cannot be undone.</>,
      tone: 'danger',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      icon: 'delete-bin-line',
    });
    if (!ok) return;
    try {
      await api.delete(`/announcements/${row.id}`);
      toast.success('Deleted', `${row.code} removed.`);
      fetchAll();
    } catch (err: any) {
      toast.error('Could not delete', err?.response?.data?.message || 'Please try again.');
    }
  };

  const handlePublishNow = async (row: AnnRow) => {
    if (publishingId) return;            // ignore double-clicks while in flight
    // Drafts can be saved with blank fields, but publishing requires the
    // mandatory content — block here and point the user back to the editor.
    const missing: string[] = [];
    if (!row.title?.trim())       missing.push('Announcement Title');
    if (!row.description?.trim()) missing.push('Description');
    if (missing.length) {
      toast.error('Cannot publish', `Please fill the required field${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`);
      setEditingRow(row);               // open the editor so they can complete it
      setCreateOpen(true);
      return;
    }
    setPublishingId(row.id);             // instant feedback (spinner + disable)
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
    } finally {
      setPublishingId(null);
    }
  };

  return (
    <>
      <MasterFormStyles />
      <Row>
        <Col xs={12}>
          <div className="rec-page">
            {/* Header strip — same shape as the Clients / Branches headers. */}
            <div className="frm-cstrip mb-3">
              <span className="frm-cstrip-accent" />
              <div className="frm-cstrip-left">
                <div className="frm-cstrip-icon"><i className="ri-send-plane-line" /></div>
                <div className="min-w-0">
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <span className="frm-cstrip-title">Broadcast Centre</span>
                    <span className="rec-pill" style={{ background: 'rgba(56,189,248,0.16)', color: '#0284c7', fontSize: 11 }}>Communication</span>
                  </div>
                  <div className="frm-cstrip-sub">
                    Create, schedule and manage company-wide announcements with audience targeting and acknowledgement tracking
                  </div>
                </div>
              </div>
            </div>

            {/* KPI strip — 4 even columns at md+ so the cards stretch the
                full width (Total / Draft / Published / High Priority). Drops
                to 2 at sm, 1 at xs. */}
            <Row className="g-2 mb-3 align-items-stretch rec-page-kpis row-cols-1 row-cols-sm-2 row-cols-md-4">
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
                    <button type="button" className="rec-btn-primary ms-auto" onClick={() => { setEditingRow(null); setCreateOpen(true); }}>
                      <i className="ri-add-line" />New Announcement
                    </button>
                  </div>

                  <div className="rec-list-scroll">
                    <table className="rec-list-table align-middle table-nowrap mb-0">
                      <thead>
                        <tr>
                          <th className="ps-3 text-center" style={{ width: 60 }}>Sr No</th>
                          <th style={{ width: 100 }}>ANN ID</th>
                          <th>Announcement Title</th>
                          <th style={{ width: 100 }}>Type</th>
                          <th style={{ width: 100 }}>Priority</th>
                          <th>Audience</th>
                          <th style={{ width: 130 }}>Publish Date</th>
                          <th className="text-center pe-3" style={{ width: 180 }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {loading ? (
                          <ShimmerTableRows rows={5} cols={9} />
                        ) : visible.length === 0 ? (
                          <tr><td colSpan={8} className="text-center py-5 text-muted">
                            <i className="ri-send-plane-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                            {rows.length === 0 ? 'No announcements yet — click New Announcement to add one' : 'No announcements match your filters'}
                          </td></tr>
                        ) : visible.map((r, idx) => {
                          const tt = TYPE_TONES[r.type];
                          const pp = PRIORITY_TONES[r.priority];
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
                              {/* `--pill-fg` carries the badge hue to the dark-mode
                                  CSS so it can swap the harsh light-pastel fill for a
                                  translucent same-hue chip (matching the ANN-ID pill).
                                  Light mode keeps the inline bg/fg untouched. */}
                              <td><span className="rec-pill" style={{ background: tt.bg, color: tt.fg, ['--pill-fg' as any]: tt.fg }}>{r.type}</span></td>
                              <td><span className="rec-pill" style={{ background: pp.bg, color: pp.fg, ['--pill-fg' as any]: pp.fg }}>{r.priority}</span></td>
                              <td className="fs-13">
                                <AudienceCell row={r} />
                              </td>
                              <td className="fs-13"><span className="rec-date">{r.publish_at ? formatDate(r.publish_at) : (r.status === 'Draft' ? '—' : formatDate(r.created_at))}</span></td>
                              <td className="pe-3 text-center">
                                {/* text-center on the cell centres the action
                                    icons under the centered "Actions" header —
                                    rec-row-actions is display:inline-flex, so its
                                    own justify-content-center can't position the
                                    block; the cell's text-align does. */}
                                <div className="rec-row-actions justify-content-center">
                                  {/* Polished portal tooltips (matching the rest of the
                                      app) replace the slow native `title` attribute, which
                                      had a ~1s browser delay and plain OS styling — so the
                                      icons read as "no tooltip" on a quick hover. */}
                                  {/* Draft rows are meant to be finished before
                                      publishing, so show an Edit (pencil) icon;
                                      published rows show a View (eye) icon. Both
                                      open the same wizard. */}
                                  <Tooltip label={r.status === 'Draft' ? 'Edit' : 'View'}>
                                    <button
                                      type="button"
                                      className={`rec-act ${r.status === 'Draft' ? 'rec-act-edit' : 'rec-act-view'} rec-act--icon`}
                                      aria-label={r.status === 'Draft' ? 'Edit' : 'View'}
                                      onClick={() => { setEditingRow(r); setCreateOpen(true); }}
                                    >
                                      <i className={r.status === 'Draft' ? 'ri-pencil-line' : 'ri-eye-line'} />
                                    </button>
                                  </Tooltip>
                                  {r.status === 'Draft' && (
                                    <Tooltip label={publishingId === r.id ? 'Publishing…' : 'Publish Now'}>
                                      <button type="button" className="rec-act rec-act-approve rec-act--icon" aria-label="Publish Now" disabled={publishingId === r.id} onClick={() => handlePublishNow(r)}>
                                        {publishingId === r.id
                                          ? <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                                          : <i className="ri-send-plane-line" />}
                                      </button>
                                    </Tooltip>
                                  )}
                                  {/* Delete is only offered for Drafts — once an
                                      announcement is published it's a record of what
                                      went out and must not be removed; published rows
                                      show View only. */}
                                  {r.status === 'Draft' && (
                                    <Tooltip label="Delete">
                                      <button type="button" className="rec-act rec-act-reject rec-act--icon" aria-label="Delete" onClick={() => handleDelete(r)}>
                                        <i className="ri-delete-bin-line" />
                                      </button>
                                    </Tooltip>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <WorklistPager
                    total={filtered.length}
                    page={safePage}
                    pageSize={pageSize}
                    onPage={goto}
                    onPageSize={(n) => { setPageSize(n); setPage(1); }}
                  />
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
        onSilentSave={handleSilentSave}
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

// 4-step wizard. Scheduling and Acknowledgement steps were removed —
// announcements always publish immediately, and the Publish action triggers
// the email blast (when Email Notification is enabled in step 3).
const STEPS: Array<{ key: number; label: string; sub: string }> = [
  { key: 1, label: 'Basic Details',    sub: 'Title, type & priority' },
  { key: 2, label: 'Audience',         sub: 'Who receives this?' },
  { key: 3, label: 'Notifications',    sub: 'Delivery channels' },
  { key: 4, label: 'Review & Publish', sub: 'Final confirmation' },
];
const TOTAL_STEPS = STEPS.length;
// Mirrors the server rule `title => max:191` so the over-length error is caught
// instantly on Step 1's "Save & Next" instead of failing at publish.
const TITLE_MAX = 191;

function CreateAnnouncementModal({
  isOpen, editing, onClose, onSaved, onSilentSave,
}: {
  isOpen: boolean;
  editing: AnnRow | null;
  onClose: () => void;
  onSaved: (row: AnnRow) => void;
  onSilentSave: (row: AnnRow) => void;
}) {
  const toast = useToast();
  const [step, setStep] = useState(1);
  // Tracks the persisted record id once a draft has been saved, so a NEW
  // announcement saved via "Save Draft" (which keeps the modal open) updates
  // the same row on the next save instead of creating duplicate drafts.
  const [savedId, setSavedId] = useState<number | null>(editing?.id ?? null);

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

  // Step 3 — only Email is exposed to the user. The other channels stay
  // in the schema (and default to false) but the form doesn't surface them.
  const [notifyEmail, setNotifyEmail] = useState(true);

  // Lookups for audience picker
  const [roles, setRoles]                       = useState<Array<{ id: number; name: string }>>([]);
  const [designations, setDesignations]         = useState<Array<{ id: number; name: string }>>([]);
  const [employees, setEmployees]               = useState<Array<{ id: number; display_name: string; emp_code?: string; primary_role_id?: number | null; ancillary_role_id?: number | null; designation_id?: number | null; designation_name?: string | null; department_name?: string | null }>>([]);

  // Which action is in flight, so only the clicked footer button spins. A
  // single boolean made Save Draft AND Publish show a loader on either click.
  const [saving, setSaving] = useState<'draft' | 'publish' | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // A published announcement is a record of what went out — the View action
  // opens this wizard read-only: the user can page through the steps to see
  // the details, but Save Draft / Publish are hidden so it can't be re-saved.
  const readOnly = !!editing && editing.status !== 'Draft';

  // Reset when opening / when editing row changes
  useEffect(() => {
    if (!isOpen) return;
    setStep(1);
    setErrors({});
    setSaving(null);
    setAttachment(null);
    setSavedId(editing?.id ?? null);

    if (editing) {
      setTitle(editing.title || '');
      setDescription(editing.description || '');
      setType(editing.type || 'General');
      setPriority(editing.priority || 'Normal');
      setAudienceType(editing.audience_type || 'all_employees');
      // IDs come back from the JSON columns as strings (FormData submits them
      // as strings and Laravel's `integer` rule validates without casting), so
      // coerce to numbers — the pickers compare with `selected.includes(o.id)`
      // against numeric option ids, and "3" !== 3 would render a blank audience.
      setRoleIds((editing.audience_role_ids || []).map(Number));
      setDesignationIds((editing.audience_designation_ids || []).map(Number));
      setExcludeIds((editing.exclude_employee_ids || []).map(Number));
      setNotifyEmail(!!editing.notify_email);
    } else {
      setTitle(''); setDescription('');
      setType('General'); setPriority('Normal');
      setAudienceType('all_employees'); setRoleIds([]); setDesignationIds([]); setExcludeIds([]);
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
          // onboarded_only → server gates to status=Active + fully onboarded
          // (onboarding_stage_completed >= 6) + not soft-deleted, so half- or
          // pending-onboarding people never enter the broadcast audience.
          api.get('/employees', { params: { onboarded_only: true } }),
        ]);
        if (cancelled) return;
        const roleRows: any[]  = Array.isArray(rolesRes.data) ? rolesRes.data : [];
        const desigRows: any[] = Array.isArray(desigRes.data) ? desigRes.data : [];
        const empRows: any[]   = Array.isArray(empRes.data)   ? empRes.data   : [];
        const isActive = (r: any) => !r.status || String(r.status).toLowerCase() === 'active';
        setRoles(roleRows.filter(isActive).map(r => ({ id: r.id, name: r.name })));
        setDesignations(desigRows.filter(isActive).map(r => ({ id: r.id, name: r.name })));
        // Only ACTIVE employees may be excluded — disabled (soft-deleted) and
        // exited (Resigned / Terminated / Inactive) people shouldn't appear in
        // the Exclude Employee picker. Mirrors the `enabled` rule the HR
        // Employees list uses.
        const empSelectable = (e: any) => {
          if (e.deleted_at) return false;
          const s = String(e.status || 'Active').toLowerCase();
          return s !== 'inactive' && s !== 'terminated' && s !== 'resigned';
        };
        setEmployees(empRows.filter(empSelectable).map(e => ({
          id: e.id,
          display_name: e.display_name || `${e.first_name || ''} ${e.last_name || ''}`.trim() || `Employee #${e.id}`,
          emp_code: e.emp_code,
          primary_role_id: e.primary_role_id ?? null,
          ancillary_role_id: e.ancillary_role_id ?? null,
          designation_id: e.designation_id ?? null,
          department_name: e.department?.name || null,
          // Designation label for the Exclude picker. Mirrors managers():
          // employee's own designation first, then the linked branch/login
          // user's designation string, finally the readable user_type — so
          // branch users (no designation_id of their own) still show a label.
          designation_name: e.designation?.name
            || e.user?.designation
            || (e.user?.user_type ? String(e.user.user_type).replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) : null),
        })));
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
    // Filter the same way the backend's computeAudienceCount does so the
    // preview matches the saved audience_count exactly. The /employees
    // lookup carries primary_role_id / ancillary_role_id / designation_id,
    // so role- and designation-based targeting can be resolved client-side.
    let pool = employees;
    if (audienceType === 'roles') {
      if (roleIds.length === 0) return 0;
      const set = new Set(roleIds);
      pool = pool.filter(e =>
        (e.primary_role_id != null && set.has(e.primary_role_id)) ||
        (e.ancillary_role_id != null && set.has(e.ancillary_role_id)));
    } else if (audienceType === 'designations') {
      if (designationIds.length === 0) return 0;
      const set = new Set(designationIds);
      pool = pool.filter(e => e.designation_id != null && set.has(e.designation_id));
    }
    if (excludeIds.length > 0) {
      const set = new Set(excludeIds);
      pool = pool.filter(e => !set.has(e.id));
    }
    return pool.length;
  }, [employees, audienceType, roleIds, designationIds, excludeIds]);

  const validateStep = (s: number): boolean => {
    const e: Record<string, string> = {};
    if (s === 1) {
      if (!title.trim()) e.title = 'Title is required';
      else if (title.trim().length > TITLE_MAX) e.title = `Title must be ${TITLE_MAX} characters or fewer (currently ${title.trim().length}).`;
      if (!description.trim()) e.description = 'Description is required';
    }
    if (s === 2) {
      // BUG-121 / BUG-122: Role-Based / Designation-Based must pick at least
      // one option — All Employees needs none.
      if (audienceType === 'roles' && roleIds.length === 0) {
        e.audience = 'Select at least one role.';
      } else if (audienceType === 'designations' && designationIds.length === 0) {
        e.audience = 'Select at least one designation.';
      }
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = () => { if (validateStep(step)) setStep(s => Math.min(TOTAL_STEPS, s + 1)); };
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

    // Scheduling step was removed — every publish is immediate. Backend
    // resolveLifecycleStatus then maps this to status='Active'.
    fd.append('publish_type', 'immediate');

    // Acknowledgement step was removed — defaults preserve schema NOT NULL
    // constraints without surfacing the controls.
    fd.append('ack_required', '0');
    fd.append('ack_mode', 'Optional');
    fd.append('ack_reminder_frequency', 'Never');
    fd.append('ack_escalation_days', '0');

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
    setSaving(asDraft ? 'draft' : 'publish');
    try {
      const fd = buildPayload(asDraft ? 'Draft' : null);
      // Treat as an update when we already have a persisted id — either editing
      // an existing row OR re-saving a draft created earlier in this session.
      const isEdit = savedId != null;
      if (isEdit) fd.append('_method', 'PUT');
      const url = isEdit ? `/announcements/${savedId}` : '/announcements';
      const { data } = await api.post(url, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success(asDraft ? 'Saved as draft' : (isEdit ? 'Announcement updated' : 'Announcement published'),
        `${data.code || data.id} saved.`);
      if (asDraft) {
        // Keep the modal open; remember the id so the next save updates this
        // same record instead of inserting another draft.
        setSavedId(data.id);
        onSilentSave(data);
      } else {
        onSaved(data);
      }
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
      setSaving(null);
    }
  };

  // Live preview helpers
  const audienceLabel =
    audienceType === 'all_employees' ? 'All Employees'
    : audienceType === 'roles'        ? `Roles: ${roleIds.length === 0 ? '—' : roles.filter(r => roleIds.includes(r.id)).map(r => r.name).join(', ')}`
                                       : `Desig: ${designationIds.length === 0 ? '—' : designations.filter(d => designationIds.includes(d.id)).map(d => d.name).join(', ')}`;

  return (
    <Modal
      isOpen={isOpen}
      toggle={onClose}
      centered
      size="xl"
      backdrop="static"
      keyboard={false}
      // rec-form-modal sizes the dialog (≤1180 / 96vw) so the modal feels
      // like the recruitment one instead of stretching to xl's default.
      modalClassName="rec-form-modal broadcast-form-modal"
      // rec-form-content carries the 18px radius + premium shadow + clip
      // mask so the gradient header and footer sit cleanly inside the
      // rounded corners (matches CreateRecruitmentModal's chrome).
      contentClassName="rec-form-content border-0"
    >
      <ModalBody className="p-0" style={{ background: 'var(--vz-card-bg)' }}>
        {/* Header — sky-blue gradient on the broadcast variant. The radius
            on .rec-form-content + overflow:hidden clips the top corners
            for us, so we don't need to repeat the radius here. */}
        <div style={{ padding: '14px 20px', background: 'linear-gradient(135deg, #0ea5e9 0%, #38bdf8 60%, #7dd3fc 100%)' }}>
          <div className="d-flex align-items-center justify-content-between gap-3">
            <div className="d-flex align-items-center gap-2">
              <span style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.18)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <i className="ri-send-plane-line" style={{ fontSize: 18, color: '#fff' }} />
              </span>
              <div>
                <h5 className="fw-bold mb-0" style={{ color: '#fff', fontSize: 16, lineHeight: 1.2 }}>{readOnly ? 'View Announcement' : editing ? 'Edit Announcement' : 'Create Announcement'}</h5>
                <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.85)' }}>Manage company-wide communications and notifications</div>
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'rgba(255,255,255,0.18)', border: 0, color: '#fff', borderRadius: 8, width: 32, height: 32 }}>
              <i className="ri-close-line" style={{ fontSize: 18 }} />
            </button>
          </div>
        </div>

        {/* Step indicator */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--vz-border-color, #e5e7eb)', overflowX: 'auto' }}>
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
                    color: active ? '#0ea5e9' : (done ? '#0ea5e9' : '#9ca3af'),
                    cursor: (done || active) ? 'pointer' : 'default', flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      width: 26, height: 26, borderRadius: '50%',
                      background: active ? '#0c63b0' : (done ? '#0ea5e9' : 'var(--vz-border-color, #e5e7eb)'),
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
            {/* View mode = 100% read-only. The disabled fieldset blocks native
                inputs/buttons/checkboxes; pointerEvents:none additionally
                neutralises the div-based handlers (audience-type pills, the
                MultiPicker dropdown, and the file drag-and-drop zone). Footer
                paging (Next) lives outside this wrapper so the user can still
                page through the steps. */}
            <fieldset
              disabled={readOnly}
              style={{ border: 0, padding: 0, margin: 0, minInlineSize: 'auto', pointerEvents: readOnly ? 'none' : undefined }}
            >
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
                errors={errors}
              />
            )}
            {step === 3 && (
              <Step3Notify
                notifyEmail={notifyEmail} setNotifyEmail={setNotifyEmail}
              />
            )}
            {step === 4 && (
              <Step4Review
                title={title} description={description} type={type} priority={priority}
                audienceLabel={audienceLabel} audienceCount={audienceCount}
                notifyEmail={notifyEmail}
                editing={editing}
              />
            )}
            </fieldset>
          </div>

          {/* Live preview — sits on the right of every step */}
          <div style={{ flex: '0 0 320px', borderLeft: '1px solid var(--vz-border-color, #e5e7eb)', padding: 16, background: 'var(--vz-secondary-bg, #fafafa)', maxHeight: '70vh', overflowY: 'auto' }}>
            <div className="text-uppercase fw-semibold mb-2" style={{ fontSize: 10.5, letterSpacing: '0.06em', color: 'var(--vz-secondary-color, #6b7280)' }}>Live Preview</div>
            {/* Translucent sky tint instead of a solid light-blue fill so the
                preview card + status box stay legible in dark mode (the solid
                #e0f2fe / #f0f9ff used to render as bright blocks with washed
                text on the dark modal). Text now uses theme variables. */}
            <div style={{ background: 'rgba(56,189,248,0.14)', border: '1px solid rgba(56,189,248,0.22)', borderRadius: 12, padding: 14, marginBottom: 12 }}>
              <div className="d-flex align-items-center justify-content-between mb-2">
                <i className="ri-send-plane-line" style={{ fontSize: 22, color: '#0ea5e9' }} />
              </div>
              {/* wordBreak + overflowWrap so a long title/description (esp. a
                  pasted no-space string) wraps inside the preview card instead
                  of spilling past its right edge. */}
              <div className="fw-bold" style={{ fontSize: 14, color: 'var(--vz-heading-color, var(--vz-body-color))', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{title || 'Announcement Title'}</div>
              <div style={{ fontSize: 12, color: 'var(--vz-secondary-color, #475569)', minHeight: 18, wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{description || 'Description appears here…'}</div>
              <div className="d-flex align-items-center justify-content-between mt-2">
                <span style={{ fontSize: 11, color: 'var(--vz-body-color, #0c63b0)' }}>{audienceLabel}</span>
                <span className="rec-pill" style={{ background: TYPE_TONES[type].bg, color: TYPE_TONES[type].fg, ['--pill-fg' as any]: TYPE_TONES[type].fg, fontSize: 10.5 }}>{type}</span>
              </div>
            </div>
            <div style={{ background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.22)', borderRadius: 10, padding: 12, fontSize: 12.5, color: 'var(--vz-body-color, #0c4a6e)' }}>
              <div><strong>Status:</strong> {editing?.status || 'Active'}</div>
              <div><strong>Priority:</strong> {priority}</div>
              <div><strong>Audience:</strong> {audienceLabel.replace(/^(Roles|Desig): /, '')} ({audienceCount})</div>
              <div><strong>Publish:</strong> Immediately</div>
              <div><strong>Notify:</strong> {notifyEmail ? 'Email' : '—'}</div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--vz-border-color, #e5e7eb)', background: 'var(--vz-secondary-bg, #fafafa)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="text-muted" style={{ fontSize: 12 }}>Step {step} of {TOTAL_STEPS}</span>
          <div className="d-flex gap-2">
            <button type="button" className="rec-btn-ghost" onClick={onClose} disabled={!!saving}>Cancel</button>
            {step > 1 && (
              <button type="button" className="rec-btn-ghost" onClick={handleBack} disabled={!!saving}>
                <i className="ri-arrow-left-line" />Back
              </button>
            )}
            {/* Read-only (published) → no Save Draft / Publish; just let the
                user page through to view, with Cancel to close. */}
            {readOnly ? (
              step < TOTAL_STEPS && (
                <button type="button" className="rec-btn-primary" onClick={() => setStep(s => Math.min(TOTAL_STEPS, s + 1))}>
                  Next<i className="ri-arrow-right-line" />
                </button>
              )
            ) : (
              <>
                <button type="button" className="rec-btn-ghost" onClick={() => handleSubmit(true)} disabled={!!saving}>
                  {saving === 'draft' ? <Spinner size="sm" /> : <i className="ri-save-3-line" />}Save Draft
                </button>
                {step < TOTAL_STEPS ? (
                  <button type="button" className="rec-btn-primary" onClick={handleNext} disabled={!!saving}>
                    Save & Next<i className="ri-arrow-right-line" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSubmit(false)}
                    disabled={!!saving}
                    style={{
                      padding: '8px 18px', borderRadius: 10, border: 0,
                      background: 'linear-gradient(135deg, #047857 0%, #10b981 100%)',
                      color: '#fff', fontSize: 13, fontWeight: 700,
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                    }}
                  >
                    {saving === 'publish' ? <Spinner size="sm" /> : <i className="ri-send-plane-line" />}Publish
                  </button>
                )}
              </>
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
  // Client-side guard for the 20 MB attachment cap — the input only restricts
  // file type, so without this an oversize file was silently accepted.
  const MAX_ATTACHMENT_MB = 20;
  // Allowed extensions mirror the server's mimes:png,jpg,jpeg,pdf rule. The
  // `accept` attr only filters the OS picker (and is bypassed by "All files" /
  // drag-drop), so we re-check the extension here to surface a red inline
  // error the instant a disallowed file (e.g. a Word .docx) is chosen, rather
  // than letting it fail at publish with a generic wrapper.
  const ALLOWED_EXTS = ['png', 'jpg', 'jpeg', 'pdf'];
  const [fileError, setFileError] = useState('');
  return (
    <>
      <div className="text-uppercase fw-semibold mb-3" style={{ color: '#0ea5e9' }}>
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
              <button key={v} type="button" onClick={() => setType(v)}
                className={`rec-priority-pill${type === v ? ' is-active' : ''}`}
                // Unselected → no inline style, so the .rec-priority-pill class
                // (which has proper light AND dark backgrounds) owns the look.
                // Selected → pastel fill for light mode + `--pill-fg` so the
                // dark-mode CSS swaps it for a translucent same-hue chip.
                style={type === v ? {
                  background: TYPE_TONES[v].bg, color: TYPE_TONES[v].fg,
                  border: `1px solid ${TYPE_TONES[v].fg}`, ['--pill-fg' as any]: TYPE_TONES[v].fg,
                } : undefined}>{v}</button>
            ))}
          </div>
        </Col>
        <Col md={6}>
          <label className="rec-form-label">Priority<span className="req">*</span></label>
          <div className="d-flex gap-2 flex-wrap">
            {(['Normal','High','Critical'] as AnnPriority[]).map(v => (
              <button key={v} type="button" onClick={() => setPriority(v)}
                className={`rec-priority-pill${priority === v ? ' is-active' : ''}`}
                style={priority === v ? {
                  background: PRIORITY_TONES[v].bg, color: PRIORITY_TONES[v].fg,
                  border: `1px solid ${PRIORITY_TONES[v].fg}`, ['--pill-fg' as any]: PRIORITY_TONES[v].fg,
                } : undefined}>{v}</button>
            ))}
          </div>
        </Col>
      </Row>
      <div className="mt-3">
        <label className="rec-form-label">Attachment (Optional)</label>
        <div
          onClick={() => fileRef.current?.click()}
          style={{
            border: '1px dashed rgba(99,102,241,0.45)', borderRadius: 10,
            padding: '20px', textAlign: 'center', cursor: 'pointer',
            background: attachment ? 'rgba(99,102,241,0.12)' : 'var(--vz-secondary-bg, #fafafa)',
          }}
        >
          <i className="ri-upload-cloud-line" style={{ fontSize: 24, color: '#6366f1' }} />
          <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4, color: 'var(--vz-body-color)' }}>
            {attachment ? attachment.name : 'Click to upload (PNG, JPG, PDF · max 20MB)'}
          </div>
          {!attachment && <div style={{ fontSize: 11, color: 'var(--vz-secondary-color, #6b7280)' }}>or drag and drop here</div>}
          <input
            ref={fileRef}
            type="file"
            accept=".png,.jpg,.jpeg,.pdf"
            style={{ display: 'none' }}
            onChange={e => {
              const f = e.target.files?.[0] ?? null;
              if (f) {
                const ext = (f.name.split('.').pop() || '').toLowerCase();
                if (!ALLOWED_EXTS.includes(ext)) {
                  setFileError(`"${f.name}" is not an allowed file type. Please upload a PNG, JPG, or PDF file.`);
                  setAttachment(null);
                  e.currentTarget.value = '';   // allow re-selecting after fixing
                  return;
                }
                if (f.size > MAX_ATTACHMENT_MB * 1024 * 1024) {
                  setFileError(`File size exceeds the maximum limit of ${MAX_ATTACHMENT_MB} MB. Please upload a file smaller than ${MAX_ATTACHMENT_MB} MB.`);
                  setAttachment(null);
                  e.currentTarget.value = '';   // allow re-selecting the same file after fixing
                  return;
                }
              }
              setFileError('');
              setAttachment(f);
            }}
          />
        </div>
        {fileError && <div className="rec-error mt-1"><i className="ri-error-warning-line" />{fileError}</div>}
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
  errors = {},
}: any) {
  // Total tenant headcount drives the All-Employees banner — the picked
  // role/designation case shows its own picker count instead.
  const totalEmps = employees.length;

  return (
    <>
      <div className="text-uppercase fw-semibold mb-3" style={{ color: '#0ea5e9' }}>
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
                background: active ? 'rgba(56,189,248,0.16)' : 'var(--vz-secondary-bg, #fff)',
                color: active ? '#0ea5e9' : 'var(--vz-body-color, #475569)',
                border: active ? '1px solid #0ea5e9' : '1px solid var(--vz-border-color, #e5e7eb)',
              }}>{o.label}</button>
            );
          })}
        </div>
      </div>

      {/* All Employees → green delivered banner + tiny "x selected" chip. */}
      {audienceType === 'all_employees' && (
        <>
          <div style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.30)', borderRadius: 10, padding: '12px 16px', marginBottom: 10, color: 'var(--vz-body-color, #15803d)', fontSize: 13 }}>
            <i className="ri-checkbox-circle-line me-1" style={{ color: '#22c55e' }} /> Announcement delivered to all <strong>{totalEmps}</strong> employee{totalEmps === 1 ? '' : 's'}.
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 18, background: 'rgba(34,211,238,0.14)', color: 'var(--vz-body-color, #0e7490)', fontSize: 12.5, fontWeight: 600, border: '1px solid rgba(34,211,238,0.30)', marginBottom: 14 }}>
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
          {errors.audience && <div className="text-danger mt-1" style={{ fontSize: 12 }}><i className="ri-error-warning-line me-1" />{errors.audience}</div>}
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
          {errors.audience && <div className="text-danger mt-1" style={{ fontSize: 12 }}><i className="ri-error-warning-line me-1" />{errors.audience}</div>}
        </div>
      )}

      {/* Exclude is shown for every audience type — it's how the user
          carves individuals out of the otherwise-matching set. */}
      <div>
        <label className="rec-form-label">EXCLUDE (OPTIONAL)</label>
        <MultiPicker
          options={employees.map((e: any) => {
            // Bracketed suffix = "Department - Designation"; whichever side is
            // missing is dropped so we never render a dangling "- Designation".
            const meta = [e.department_name, e.designation_name].filter(Boolean).join(' - ');
            return {
              id: e.id,
              label: `${e.display_name}${e.emp_code ? ' · ' + e.emp_code : ''}${meta ? ' (' + meta + ')' : ''}`,
            };
          })}
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
      <div style={{ padding: 16, border: '1px solid var(--vz-border-color, #e5e7eb)', borderRadius: 10, color: '#9ca3af', fontSize: 13, textAlign: 'center' }}>
        {empty || 'No options available'}
      </div>
    );
  }
  const toggle = (id: number) => {
    if (selected.includes(id)) onChange(selected.filter(x => x !== id));
    else onChange([...selected, id]);
  };
  return (
    <div style={{ padding: 14, border: '1px solid var(--vz-border-color, #e5e7eb)', borderRadius: 10, background: 'var(--vz-secondary-bg, #fff)' }}>
      <div className="d-flex flex-wrap" style={{ gap: 10 }}>
        {options.map(o => {
          const active = selected.includes(o.id);
          return (
            <label
              key={o.id}
              className="d-inline-flex align-items-center"
              style={{
                gap: 6, padding: '6px 12px', borderRadius: 8,
                background: active ? 'rgba(56,189,248,0.16)' : 'var(--vz-secondary-bg, #fff)',
                border: active ? '1px solid #0c63b0' : '1px solid var(--vz-border-color, #e5e7eb)',
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
            <span key={id} className="rec-pill" style={{ background: 'rgba(56,189,248,0.16)', color: 'var(--vz-body-color, #0c63b0)', fontSize: 11.5 }}>
              {o.label}
              <i className="ri-close-line ms-1" onClick={(e) => { e.stopPropagation(); toggle(id); }} style={{ cursor: 'pointer' }} />
            </span>
          );
        })}
        {selected.length > 4 && <span className="text-muted" style={{ fontSize: 11.5 }}>+{selected.length - 4} more</span>}
      </div>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: 'var(--vz-secondary-bg, #fff)', border: '1px solid var(--vz-border-color, #e5e7eb)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.10)', zIndex: 10, maxHeight: 240, overflowY: 'auto' }}>
          <div style={{ padding: 8, borderBottom: '1px solid var(--vz-border-color, #e5e7eb)' }}>
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
          <div style={{ padding: 8, borderTop: '1px solid var(--vz-border-color, #e5e7eb)', textAlign: 'right' }}>
            <button type="button" className="rec-btn-ghost" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Step 3 — Notifications ──────────────────────────────────────────────────
// Email is the only delivery channel exposed to the user. The schema still
// carries notify_in_app / notify_sms / notify_whatsapp; buildPayload sends
// false for all of them so a previously-checked value gets cleared on edit.
function Step3Notify({ notifyEmail, setNotifyEmail }: { notifyEmail: boolean; setNotifyEmail: (v: boolean) => void }) {
  return (
    <>
      <div className="d-flex align-items-center gap-2 mb-3" style={{ color: '#0ea5e9' }}>
        <i className="ri-notification-3-line" />
        <span className="fw-semibold" style={{ fontSize: 14 }}>Notification Channels</span>
      </div>
      <hr className="mt-1 mb-3" style={{ borderColor: '#e5e7eb' }} />

      <label
        className="d-flex align-items-center gap-3 p-3 mb-3"
        style={{
          border: notifyEmail ? '1.5px solid #0ea5e9' : '1px solid var(--vz-border-color, #e5e7eb)',
          borderRadius: 10, cursor: 'pointer',
          background: notifyEmail ? 'rgba(56,189,248,0.12)' : 'var(--vz-secondary-bg, #fff)',
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
          <span className="fw-bold" style={{ fontSize: 14, color: 'var(--vz-heading-color, var(--vz-body-color))' }}>Email Notification</span>
          <span style={{ fontSize: 12, color: 'var(--vz-secondary-color, #6b7280)' }}>Send directly to each recipient's inbox when you publish</span>
        </div>
      </label>

      {/* Info note — styled as a proper Note/Info alert (icon + "Note:" label
          + light-blue highlight) so it reads as guidance, not a disabled field. */}
      <div
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 8,
          background: 'rgba(56,189,248,0.10)', border: '1px solid rgba(56,189,248,0.28)', borderRadius: 10,
          padding: '10px 14px', color: 'var(--vz-body-color, #0c4a6e)', fontSize: 12.5,
        }}
      >
        <i className="ri-information-line" style={{ fontSize: 16, color: '#0ea5e9', flexShrink: 0, marginTop: 1 }} />
        <span>
          <strong>Note:</strong> Email notification is optional. The announcement will still be visible in the system regardless.
        </span>
      </div>
    </>
  );
}

// ── Step 4 — Review & Publish ───────────────────────────────────────────────
function Step4Review({
  title, description, type, priority,
  audienceLabel, audienceCount,
  notifyEmail,
  editing,
}: any) {
  const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div style={{ background: 'var(--vz-secondary-bg, #fafafa)', border: '1px solid var(--vz-border-color, #e5e7eb)', borderRadius: 8, padding: '8px 12px' }}>
      <div className="text-uppercase fw-semibold" style={{ fontSize: 10, letterSpacing: '0.05em', color: 'var(--vz-secondary-color, #6b7280)' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{value || <span className="text-muted">—</span>}</div>
    </div>
  );
  return (
    <>
      <div className="text-uppercase fw-semibold mb-3" style={{ color: '#0ea5e9' }}>
        <i className="ri-file-text-line" /> Review & Publish
      </div>
      <div style={{ border: '1px solid var(--vz-border-color, #e5e7eb)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <div className="fw-bold" style={{ fontSize: 16 }}>{title || '—'}</div>
        <div className="text-muted mb-3" style={{ fontSize: 13 }}>{description || '—'}</div>
        <Row className="g-2">
          <Col md={3}><Field label="Type" value={type} /></Col>
          <Col md={3}><Field label="Priority" value={priority} /></Col>
          <Col md={3}><Field label="Audience" value={audienceLabel} /></Col>
          <Col md={3}><Field label="Count" value={`${audienceCount} employees`} /></Col>
          <Col md={3}><Field label="Publish" value="Immediately" /></Col>
          <Col md={3}><Field label="Notify" value={notifyEmail ? 'Email' : '—'} /></Col>
        </Row>
      </div>
      {editing && (
        <div className="text-muted" style={{ fontSize: 12 }}>
          Editing <strong>{editing.code}</strong> · created {formatDateTime(editing.created_at)}
          {editing.creator?.name ? <> by {editing.creator.name}</> : null}
        </div>
      )}
      <div style={{ background: 'rgba(56,189,248,0.10)', border: '1px solid rgba(56,189,248,0.22)', borderRadius: 10, padding: 12, color: 'var(--vz-body-color, #0c4a6e)', fontSize: 13, marginTop: 12 }}>
        <i className="ri-information-line" /> Clicking <strong>Publish</strong> will make this announcement live immediately
        {notifyEmail ? ' and email every selected recipient.' : '.'}
      </div>
    </>
  );
}
