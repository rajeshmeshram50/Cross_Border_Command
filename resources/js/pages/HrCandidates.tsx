import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardBody, Col, Row, Modal, ModalBody, Spinner, Input } from 'reactstrap';
import { MasterSelect, MasterFormStyles } from './master/masterFormKit';
import { useToast } from '../contexts/ToastContext';
import api from '../api';
import '../../css/recruitment.css';

// ── Types ────────────────────────────────────────────────────────────────────
type CandidateStatus =
  | 'Applied' | 'Shortlisted' | 'In Interview' | 'Final Interview'
  | 'Selected' | 'Offered' | 'Rejected' | 'On Hold';

interface CandidateRow {
  id: number;
  recruitment_id: number;
  recruitment_code: string | null;
  recruitment_title: string | null;
  name: string;
  initials: string;
  accent: string;
  email: string | null;
  mobile: string | null;
  current_address: string | null;
  qualification: string | null;
  experience_years: number;
  mode_of_transport: string | null;
  distance_km: number | null;
  current_salary_lpa: number | null;
  expected_salary_lpa: number | null;
  notice_period: string | null;
  source: string | null;
  cv_path: string | null;
  cv_url: string | null;
  status: CandidateStatus;
  created_at: string | null;
}

interface RecruitmentInfo {
  id: string;
  code: string;
  jobTitle: string;
  department: string | null;
  designation: string | null;
  employmentType: string | null;
  openings: number;
  experience: string | null;
  workMode: string | null;
  priority: string | null;
  hiringManagerRaw: string | null;
  assignedHrName: string | null;
  startDate: string | null;
  deadline: string | null;
  status: string;
}

const STATUSES: CandidateStatus[] = [
  'Applied', 'Shortlisted', 'In Interview', 'Final Interview',
  'Selected', 'Offered', 'Rejected', 'On Hold',
];

const SOURCES = ['LinkedIn', 'Naukri', 'Indeed', 'Referral', 'Company Website', 'Walk-in', 'Recruitment Agency', 'Internal', 'Other'];
const NOTICE_PERIODS = ['Immediate', '15 Days', '30 Days', '45 Days', '60 Days', '90 Days'];
const TRANSPORT_MODES = ['Walk', 'Bicycle', 'Two-wheeler', 'Four-wheeler', 'Public Transport', 'Other'];

// Pretty-print dates as 05-Apr-2026
const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatDate(raw: any): string {
  if (raw == null || raw === '') return '—';
  const d = new Date(String(raw));
  if (isNaN(d.getTime())) return String(raw);
  const dd = String(d.getDate()).padStart(2, '0');
  return `${dd}-${MONTH_ABBR[d.getMonth()]}-${d.getFullYear()}`;
}

const STATUS_TONES: Record<CandidateStatus, { bg: string; fg: string; dot: string }> = {
  'Applied':         { bg: '#fef3c7', fg: '#92400e', dot: '#f59e0b' },
  'Shortlisted':     { bg: '#e0f2fe', fg: '#1d4ed8', dot: '#3b82f6' },
  'In Interview':    { bg: '#ddd6fe', fg: '#5b21b6', dot: '#7c3aed' },
  'Final Interview': { bg: '#ede9fe', fg: '#5b3fd1', dot: '#7c5cfc' },
  'Selected':        { bg: '#dcfce7', fg: '#15803d', dot: '#22c55e' },
  'Offered':         { bg: '#d1fae5', fg: '#047857', dot: '#10b981' },
  'Rejected':        { bg: '#fee2e2', fg: '#b91c1c', dot: '#ef4444' },
  'On Hold':         { bg: '#f3f4f6', fg: '#4b5563', dot: '#9ca3af' },
};

export default function HrCandidates() {
  const { id: recruitmentId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [recruitment, setRecruitment] = useState<RecruitmentInfo | null>(null);
  const [candidates, setCandidates]   = useState<CandidateRow[]>([]);
  const [loading, setLoading]         = useState(true);
  const [tab, setTab]                 = useState<'all' | 'final' | 'selected' | 'rejected'>('final');
  const [search, setSearch]           = useState('');
  const [sourceFilter, setSourceFilter] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing]     = useState<CandidateRow | null>(null);
  const [sampleOpen, setSampleOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  // Selection / Rejection confirmation
  const [confirming, setConfirming] = useState<{ row: CandidateRow; mode: 'select' | 'reject' } | null>(null);

  const fetchAll = async () => {
    if (!recruitmentId) return;
    try {
      setLoading(true);
      const [sumRes, listRes] = await Promise.all([
        api.get(`/recruitments/${recruitmentId}/candidates/summary`),
        api.get(`/candidates?recruitment_id=${recruitmentId}`),
      ]);
      setRecruitment(sumRes.data?.recruitment || null);
      setCandidates(Array.isArray(listRes.data) ? listRes.data : []);
    } catch (err: any) {
      toast.error('Could not load candidates', err?.response?.data?.message || 'Please try again.');
      setRecruitment(null);
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetchAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [recruitmentId]);

  const totals = useMemo(() => {
    const t = candidates.length;
    const applied = candidates.filter(c => c.status === 'Applied' || c.status === 'Shortlisted').length;
    const inInterview = candidates.filter(c => c.status === 'In Interview' || c.status === 'Final Interview').length;
    const selected = candidates.filter(c => c.status === 'Selected').length;
    const rejected = candidates.filter(c => c.status === 'Rejected').length;
    const offered = candidates.filter(c => c.status === 'Offered').length;
    // "Active" = anyone still in the pipeline (everything except Selected /
    // Offered / Rejected). Drives the first tab's badge so newly-added
    // Applied / Shortlisted / On Hold rows show up immediately.
    const active = candidates.filter(c =>
      c.status !== 'Selected' && c.status !== 'Offered' && c.status !== 'Rejected'
    ).length;
    return { total: t, applied, inInterview, selected, rejected, offered, active };
  }, [candidates]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return candidates
      .filter(c => {
        // The "final" tab covers the whole active pipeline, not just the
        // final interview round — otherwise Applied / Shortlisted / On Hold
        // candidates have nowhere to land.
        if (tab === 'final')    return c.status !== 'Selected' && c.status !== 'Offered' && c.status !== 'Rejected';
        if (tab === 'selected') return c.status === 'Selected' || c.status === 'Offered';
        if (tab === 'rejected') return c.status === 'Rejected';
        return true;
      })
      .filter(c => sourceFilter === 'All' || c.source === sourceFilter)
      .filter(c => statusFilter === 'All' || c.status === statusFilter)
      .filter(c => {
        if (!needle) return true;
        return (
          c.name.toLowerCase().includes(needle) ||
          (c.email || '').toLowerCase().includes(needle) ||
          (c.mobile || '').toLowerCase().includes(needle) ||
          (c.recruitment_code || '').toLowerCase().includes(needle)
        );
      });
  }, [candidates, tab, sourceFilter, statusFilter, search]);

  // Reset to page 1 whenever filters change so the user never sits on an
  // empty page after the result set shrinks.
  useEffect(() => { setPage(1); }, [tab, sourceFilter, statusFilter, search]);

  // Page slice
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage  = Math.min(page, pageCount);
  const sliceFrom = (safePage - 1) * pageSize;
  const visible   = filtered.slice(sliceFrom, sliceFrom + pageSize);
  const goto = (p: number) => setPage(Math.max(1, Math.min(pageCount, p)));

  const KPI_CARDS = [
    { key: 'total',       label: 'Total',        value: totals.total,        icon: 'ri-team-line',            gradient: 'linear-gradient(135deg, #047857 0%, #10b981 60%, #34d399 100%)', deep: '#047857' },
    { key: 'applied',     label: 'Applied',      value: totals.applied,      icon: 'ri-flashlight-line',      gradient: 'linear-gradient(135deg, #c2410c 0%, #f59e0b 60%, #fbbf24 100%)', deep: '#c2410c' },
    { key: 'inInterview', label: 'In Interview', value: totals.inInterview,  icon: 'ri-file-text-line',       gradient: 'linear-gradient(135deg, #4338ca 0%, #6366f1 60%, #818cf8 100%)', deep: '#4338ca' },
    { key: 'selected',    label: 'Selected',     value: totals.selected,     icon: 'ri-checkbox-circle-line', gradient: 'linear-gradient(135deg, #047857 0%, #10b981 60%, #34d399 100%)', deep: '#047857' },
    { key: 'rejected',    label: 'Rejected',     value: totals.rejected,     icon: 'ri-close-circle-line',    gradient: 'linear-gradient(135deg, #be123c 0%, #ef4444 60%, #fb7185 100%)', deep: '#be123c' },
    { key: 'offered',     label: 'Offered',      value: totals.offered,      icon: 'ri-award-line',           gradient: 'linear-gradient(135deg, #047857 0%, #10b981 60%, #34d399 100%)', deep: '#047857' },
  ];

  const handleStatusUpdate = async (c: CandidateRow, next: CandidateStatus, reasonOrNote?: string) => {
    // Build the status payload — when rejecting, the Confirm modal sends
    // "<reason> — <notes>" which we split back into the two backend fields.
    const payload: Record<string, any> = { status: next };
    if (reasonOrNote) {
      if (next === 'Rejected') {
        const [reason, ...rest] = reasonOrNote.split(' — ');
        if (reason) payload.rejection_reason = reason.trim();
        const notes = rest.join(' — ').trim();
        if (notes) payload.status_notes = notes;
      } else {
        payload.status_notes = reasonOrNote;
      }
    }

    try {
      const { data } = await api.patch(`/candidates/${c.id}/status`, payload);
      setCandidates(prev => prev.map(r => r.id === c.id ? data : r));
      toast.success(next, `${data.name} → ${next}`);
    } catch (err: any) {
      // The backend rejects a 6th selection on a 5-opening recruitment with
      // a 422 + message attached to the `status` field. Surface that verbatim
      // so the recruiter knows exactly why it was blocked.
      const fieldErr = err?.response?.data?.errors?.status?.[0];
      const message  = fieldErr || err?.response?.data?.message || 'Please try again.';
      toast.error(next === 'Selected' ? 'Cannot mark as Selected' : 'Could not update', message);
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
                <span
                  className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
                  style={{
                    width: 46, height: 46,
                    background: 'linear-gradient(135deg, #7c5cfc 0%, #a78bfa 100%)',
                    boxShadow: '0 4px 10px rgba(124,92,252,0.30)',
                  }}
                >
                  <i className="ri-group-line" style={{ color: '#fff', fontSize: 21 }} />
                </span>
                <div className="min-w-0">
                  <h5 className="fw-bold mb-0" style={{ letterSpacing: '-0.01em' }}>Candidate Management</h5>
                  <div className="text-muted mt-1" style={{ fontSize: 12.5 }}>
                    Track candidate profiles, experience, CVs, and selection status
                  </div>
                </div>
              </div>
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <button type="button" className="cand-pill-btn cand-pill-btn--violet" onClick={() => navigate('/hr/recruitment')}>
                  <i className="ri-arrow-left-line" />Back to Recruitment List
                </button>
                <button type="button" className="cand-pill-btn cand-pill-btn--blue" title="Download a sample CSV" onClick={() => setSampleOpen(true)}>
                  <i className="ri-download-line" />Sample
                </button>
                <button type="button" className="cand-pill-btn cand-pill-btn--violet" title="Import candidates from CSV" onClick={() => setImportOpen(true)}>
                  <i className="ri-upload-2-line" />Import
                </button>
                <button type="button" className="cand-pill-btn cand-pill-btn--green" title="Export candidates" onClick={() => setExportOpen(true)}>
                  <i className="ri-external-link-line" />Export
                </button>
                <button type="button" className="cand-pill-btn cand-pill-btn--primary" onClick={() => { setEditing(null); setModalOpen(true); }}>
                  <i className="ri-add-line" />Add Candidate
                </button>
              </div>
            </div>

            {/* Recruitment context card */}
            {recruitment && (
              <div className="cand-rec-card mb-2">
                <div className="cand-rec-head">
                  <span className="cand-rec-icon">
                    <i className="ri-briefcase-4-line" />
                  </span>
                  <div className="cand-rec-titlewrap">
                    <span className="rec-id-pill">{recruitment.code}</span>
                    <h6 className="cand-rec-title">{recruitment.jobTitle}</h6>
                  </div>
                  <div className="cand-rec-pills">
                    {recruitment.priority && (
                      <span className="rec-pill" style={{ background: '#ffe4e1', color: '#b91c1c' }}>
                        <i className="ri-alarm-warning-line" style={{ fontSize: 11, marginRight: 3 }} />
                        {recruitment.priority}
                      </span>
                    )}
                    <span className="rec-pill" style={{ background: '#dcfce7', color: '#15803d' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', marginRight: 4 }} />
                      {recruitment.status}
                    </span>
                    <span className="rec-pill cand-rec-readonly">
                      <i className="ri-eye-line" style={{ fontSize: 11, marginRight: 3 }} />
                      READ ONLY
                    </span>
                  </div>
                </div>
                <div className="cand-rec-divider" />
                {/* Top half — 5 fields */}
                <div className="cand-rec-grid cand-rec-grid--top">
                  <Field label="Department"      value={recruitment.department} />
                  <Field label="Designation"     value={recruitment.designation} />
                  <Field label="Employment Type" value={recruitment.employmentType} />
                  <Field label="Openings"        value={recruitment.openings ? `${recruitment.openings} positions` : null} />
                  <Field label="Experience Req"  value={recruitment.experience} />
                </div>
                {/* Bottom half — 5 fields including Priority + Start · TAT + HR pair */}
                <div className="cand-rec-grid">
                  <Field label="Work Mode" value={recruitment.workMode} />
                  <div className="cand-field">
                    <div className="cand-field-label">Priority</div>
                    <div className="cand-field-value">
                      {recruitment.priority ? (
                        <span
                          className="rec-pill"
                          style={{
                            background:
                              recruitment.priority === 'High'   ? '#ffe4e1' :
                              recruitment.priority === 'Medium' ? '#fef3c7' :
                                                                  '#dbeafe',
                            color:
                              recruitment.priority === 'High'   ? '#b91c1c' :
                              recruitment.priority === 'Medium' ? '#92400e' :
                                                                  '#1d4ed8',
                          }}
                        >
                          {recruitment.priority}
                        </span>
                      ) : <span className="text-muted">—</span>}
                    </div>
                  </div>
                  <div className="cand-field">
                    <div className="cand-field-label">Start · TAT</div>
                    <div className="cand-field-value" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatDate(recruitment.startDate)} <span style={{ color: '#f59e0b' }}>→</span> <span style={{ color: '#f59e0b', fontWeight: 700 }}>{formatDate(recruitment.deadline)}</span>
                    </div>
                  </div>
                  <Field label="Hiring Manager" value={recruitment.hiringManagerRaw} />
                  <Field label="Assigned HR"    value={recruitment.assignedHrName} />
                </div>
              </div>
            )}

            {/* KPI strip */}
            <Row className="g-2 mb-2 align-items-stretch rec-page-kpis">
              {KPI_CARDS.map(k => (
                <Col key={k.key} xl={2} md={4} sm={6} xs={12}>
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

            {/* Tabs — segmented control */}
            <div className="mb-2">
              <div className="rec-tab-track">
                {([
                  { key: 'final' as const,    label: 'Final Round Selected', count: totals.active,                    icon: 'ri-user-search-line',     variant: 'in-progress' },
                  { key: 'selected' as const, label: 'Selected Candidates',  count: totals.selected + totals.offered, icon: 'ri-checkbox-circle-line', variant: 'completed' },
                  { key: 'rejected' as const, label: 'Rejected Candidates',  count: totals.rejected,                  icon: 'ri-close-circle-line',    variant: 'cancelled' },
                ]).map(t => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTab(t.key)}
                    className={`rec-tab ${tab === t.key ? `is-active ${t.variant}` : ''}`}
                  >
                    <i className={t.icon} />
                    {t.label}
                    <span className="badge">{t.count}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Search + Filter + Table — inside ONE card frame */}
            <Card className="border-0 shadow-none mb-0 bg-transparent">
              <CardBody className="p-0">
                <div className="rec-list-frame">
                  <div className="rec-req-filter-row d-flex align-items-center gap-2 flex-wrap">
                    <div className="rec-req-search search-box" style={{ flex: 1, minWidth: 220 }}>
                      <Input type="text" className="form-control" placeholder="Search name, email, mobile…" value={search} onChange={e => setSearch(e.target.value)} />
                      <i className="ri-search-line search-icon"></i>
                    </div>
                    <span className="text-uppercase fw-semibold" style={{ fontSize: 10.5, letterSpacing: '0.06em', color: 'var(--vz-secondary-color)' }}>Source</span>
                    <div style={{ minWidth: 150 }}>
                      <MasterSelect value={sourceFilter} onChange={setSourceFilter} options={[{ value: 'All', label: 'All' }, ...SOURCES.map(s => ({ value: s, label: s }))]} placeholder="All" />
                    </div>
                    <span className="text-uppercase fw-semibold" style={{ fontSize: 10.5, letterSpacing: '0.06em', color: 'var(--vz-secondary-color)' }}>Status</span>
                    <div style={{ minWidth: 150 }}>
                      <MasterSelect value={statusFilter} onChange={setStatusFilter} options={[{ value: 'All', label: 'All' }, ...STATUSES.map(s => ({ value: s, label: s }))]} placeholder="All" />
                    </div>
                    <span className="cand-result-chip ms-auto">
                      <i className="ri-filter-3-line" />
                      {filtered.length} result{filtered.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="rec-list-scroll">
                  <table className="rec-list-table cand-page-table align-middle table-nowrap mb-0">
                    <thead>
                      <tr>
                        <th className="ps-3 text-center" style={{ width: 56 }}>SR</th>
                        <th>Candidate</th>
                        <th>Email</th>
                        <th>Mobile</th>
                        <th className="text-center">Exp (Y)</th>
                        <th className="text-center">Current Sal</th>
                        <th className="text-center">Expected</th>
                        <th>Notice</th>
                        <th>Source</th>
                        <th className="text-center">CV</th>
                        <th>Status</th>
                        <th className="text-center pe-3" style={{ width: 130 }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? (
                        <tr><td colSpan={12} className="text-center py-5 text-muted"><Spinner size="sm" /> Loading candidates…</td></tr>
                      ) : filtered.length === 0 ? (
                        <tr>
                          <td colSpan={12} className="text-center py-5 text-muted">
                            <i className="ri-user-search-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                            No candidates match your filters
                          </td>
                        </tr>
                      ) : visible.map((c, idx) => {
                        const tone = STATUS_TONES[c.status];
                        return (
                          <tr key={c.id}>
                            <td className="ps-3 text-center text-muted fs-13">{sliceFrom + idx + 1}</td>
                            <td>
                              <div className="d-flex align-items-center gap-2">
                                <div className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                                  style={{ width: 26, height: 26, fontSize: 10.5, background: `linear-gradient(135deg, ${c.accent}, ${c.accent}cc)` }}>
                                  {c.initials}
                                </div>
                                <span className="fw-bold fs-13">{c.name}</span>
                                {c.recruitment_code && <span className="rec-id-pill" style={{ fontSize: 10, padding: '2px 7px' }}>{c.recruitment_code}</span>}
                              </div>
                            </td>
                            <td className="fs-13 text-muted">{c.email || '—'}</td>
                            <td className="fs-13">{c.mobile || '—'}</td>
                            <td className="text-center fs-13">{c.experience_years ?? 0}</td>
                            <td className="text-center fs-13"><span className="fw-semibold">{c.current_salary_lpa != null ? `${c.current_salary_lpa} L` : '—'}</span></td>
                            <td className="text-center fs-13"><span className="fw-semibold">{c.expected_salary_lpa != null ? `${c.expected_salary_lpa} L` : '—'}</span></td>
                            <td className="fs-13">{c.notice_period || '—'}</td>
                            <td className="fs-13">{c.source || '—'}</td>
                            <td className="text-center">
                              <CvCell
                                candidate={c}
                                onUploaded={(updated) => setCandidates(prev => prev.map(r => r.id === updated.id ? updated : r))}
                              />
                            </td>
                            <td>
                              <span className="rec-pill d-inline-flex align-items-center gap-1" style={{ background: tone.bg, color: tone.fg }}>
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: tone.dot }} />
                                {c.status}
                              </span>
                            </td>
                            <td className="pe-3">
                              <div className="rec-row-actions justify-content-center">
                                <button
                                  type="button"
                                  className="rec-act rec-act-approve rec-act--icon"
                                  title="Mark Selected"
                                  aria-label="Mark Selected"
                                  onClick={() => setConfirming({ row: c, mode: 'select' })}
                                >
                                  <i className="ri-check-line" />
                                </button>
                                <button
                                  type="button"
                                  className="rec-act rec-act-reject rec-act--icon"
                                  title="Mark Rejected"
                                  aria-label="Mark Rejected"
                                  onClick={() => setConfirming({ row: c, mode: 'reject' })}
                                >
                                  <i className="ri-close-line" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                  {/* Pagination footer */}
                  <div className="rec-list-footer">
                    <div className="d-flex align-items-center gap-2">
                      <span className="text-muted" style={{ fontSize: 12 }}>Rows per page:</span>
                      <div style={{ width: 80 }}>
                        <MasterSelect
                          value={String(pageSize)}
                          onChange={(v) => { setPageSize(Number(v) || 10); setPage(1); }}
                          options={['10', '25', '50'].map(v => ({ value: v, label: v }))}
                          placeholder="10"
                        />
                      </div>
                      <span className="text-muted" style={{ fontSize: 12, marginLeft: 16 }}>
                        Showing {filtered.length === 0 ? 0 : (sliceFrom + 1)}–{Math.min(sliceFrom + pageSize, filtered.length)} of {filtered.length}
                      </span>
                    </div>
                    <div className="d-flex align-items-center gap-1">
                      <button className="rec-pagebtn" onClick={() => goto(safePage - 1)} disabled={safePage <= 1}>
                        ‹ Prev
                      </button>
                      {Array.from({ length: pageCount }).map((_, i) => (
                        <button
                          key={i}
                          className={`rec-pagebtn${safePage === i + 1 ? ' is-active' : ''}`}
                          onClick={() => goto(i + 1)}
                        >
                          {i + 1}
                        </button>
                      ))}
                      <button className="rec-pagebtn" onClick={() => goto(safePage + 1)} disabled={safePage >= pageCount}>
                        Next ›
                      </button>
                    </div>
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>
        </Col>
      </Row>

      <CandidateFormModal
        open={modalOpen}
        editing={editing}
        recruitmentId={recruitmentId ? Number(recruitmentId) : null}
        recruitment={recruitment}
        onClose={() => { setModalOpen(false); setEditing(null); }}
        onSaved={(row) => {
          setCandidates(prev => {
            const idx = prev.findIndex(r => r.id === row.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = row;
              return next;
            }
            return [row, ...prev];
          });
          setModalOpen(false);
          setEditing(null);
        }}
      />

      <SampleImportFormatModal open={sampleOpen} onClose={() => setSampleOpen(false)} />
      <ImportCandidatesModal
        open={importOpen}
        recruitment={recruitment}
        onClose={() => setImportOpen(false)}
        onImport={async (file) => {
          if (!recruitmentId) {
            toast.error('Cannot import', 'No recruitment selected.');
            return;
          }
          // POST the file to /candidates/import with the parent recruitment id.
          // The backend validates each row and returns a per-row error list
          // so the user sees exactly what's wrong with which line.
          const fd = new FormData();
          fd.append('file', file);
          fd.append('recruitment_id', String(recruitmentId));

          try {
            const { data } = await api.post('/candidates/import', fd, {
              headers: { 'Content-Type': 'multipart/form-data' },
            });
            const created = Number(data?.created || 0);
            const skipped = Number(data?.skipped || 0);
            const errors  = Array.isArray(data?.errors) ? data.errors : [];

            if (created > 0) {
              toast.success('Import complete', `${created} candidate${created === 1 ? '' : 's'} added${skipped ? ` · ${skipped} skipped` : ''}.`);
              // Refresh the list so the new rows appear immediately.
              fetchAll();
            } else {
              toast.error('Nothing imported', skipped > 0 ? `${skipped} row${skipped === 1 ? '' : 's'} skipped — see errors below.` : 'No valid rows found in the file.');
            }
            // Surface the first few row-level errors so users know what to fix.
            if (errors.length > 0) {
              const sample = errors.slice(0, 3).map((e: any) => `Row ${e.row}: ${e.message}`).join('\n');
              console.warn('[Candidate import] errors:\n' + errors.map((e: any) => `Row ${e.row}: ${e.message}`).join('\n'));
              toast.error('Some rows skipped', sample + (errors.length > 3 ? `\n…and ${errors.length - 3} more.` : ''));
            }
            setImportOpen(false);
          } catch (err: any) {
            toast.error('Import failed', err?.response?.data?.message
              || err?.response?.data?.errors?.file?.[0]
              || 'Please upload a CSV that matches the Sample template.');
          }
        }}
      />

      <ExportCandidatesModal
        open={exportOpen}
        totalCount={candidates.length}
        filteredCount={filtered.length}
        onClose={() => setExportOpen(false)}
        onExport={async (scope: 'all' | 'view') => {
          // 'all' → entire candidate list scoped to this recruitment.
          // 'view' → just the rows currently visible after filters/tabs;
          //          we send the id list explicitly so the backend exports
          //          exactly what the SPA is showing.
          const params: Record<string, string> = {};
          if (recruitmentId) params.recruitment_id = String(recruitmentId);
          if (scope === 'view') {
            params.ids = filtered.map(c => c.id).join(',');
          }
          try {
            const res = await api.get('/candidates/export', { params, responseType: 'blob' });
            triggerBlobDownload(res.data, 'candidates_export.csv');
            const count = scope === 'view' ? filtered.length : candidates.length;
            toast.success('Export ready', `${count} candidate${count === 1 ? '' : 's'} downloaded`);
            setExportOpen(false);
          } catch (err: any) {
            toast.error('Could not export', err?.response?.data?.message || 'Please try again.');
          }
        }}
      />

      <CandidateConfirmModal
        target={confirming}
        onClose={() => setConfirming(null)}
        onConfirm={(reasonOrNote: string) => {
          if (!confirming) return;
          const next: CandidateStatus = confirming.mode === 'select' ? 'Selected' : 'Rejected';
          // Forward the reason/notes so the backend can stash them in
          // rejection_reason + status_notes for the audit trail.
          handleStatusUpdate(confirming.row, next, reasonOrNote);
          setConfirming(null);
        }}
      />
    </>
  );
}

// ─── Export Candidates modal ────────────────────────────────────────────────
function ExportCandidatesModal({
  open, totalCount, filteredCount, onClose, onExport,
}: {
  open: boolean;
  totalCount: number;
  filteredCount: number;
  onClose: () => void;
  onExport: (scope: 'all' | 'view') => void;
}) {
  const [scope, setScope] = useState<'all' | 'view'>('all');

  // Reset to "all" each time the modal opens so a previous "view-only" choice
  // doesn't carry over silently.
  useEffect(() => { if (open) setScope('all'); }, [open]);

  return (
    <Modal isOpen={open} toggle={onClose} centered size="md" backdrop="static" contentClassName="border-0 cand-export-modal">
      <ModalBody className="p-0" style={{ borderRadius: 16, overflow: 'hidden' }}>
        {/* Header */}
        <div className="cand-export-head">
          <span className="cand-export-head-icon">
            <i className="ri-external-link-line" />
          </span>
          <div className="cand-export-head-text">
            <h5 className="mb-0">Export Candidates</h5>
            <div className="cand-export-head-sub">Download candidate data as an Excel file</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="cand-export-close">
            <i className="ri-close-line" />
          </button>
        </div>

        {/* Body */}
        <div className="cand-export-body">
          <div className="cand-export-section-label">Scope</div>

          <label className={`cand-export-option${scope === 'all' ? ' is-selected' : ''}`}>
            <input
              type="radio"
              name="cand-export-scope"
              checked={scope === 'all'}
              onChange={() => setScope('all')}
            />
            <span className="cand-export-option-radio" />
            <div className="cand-export-option-text">
              <div className="cand-export-option-title">All Candidates</div>
              <div className="cand-export-option-sub">{totalCount} record{totalCount === 1 ? '' : 's'}</div>
            </div>
          </label>

          <label className={`cand-export-option${scope === 'view' ? ' is-selected' : ''}`}>
            <input
              type="radio"
              name="cand-export-scope"
              checked={scope === 'view'}
              onChange={() => setScope('view')}
            />
            <span className="cand-export-option-radio" />
            <div className="cand-export-option-text">
              <div className="cand-export-option-title">
                Current View Only <span className="cand-export-option-tag">(filtered)</span>
              </div>
              <div className="cand-export-option-sub">
                {filteredCount} record{filteredCount === 1 ? '' : 's'} matching current tab + filters
              </div>
            </div>
          </label>

          <div className="cand-export-info">
            <i className="ri-file-excel-2-line" />
            <div>
              <strong>File format: Excel (.xlsx)</strong> · Columns: Name, Email, Mobile,
              Experience, Current Salary, Expected Salary, Notice Period, Source, Status,
              Recruitment ID
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="cand-export-footer">
          <button type="button" className="rec-btn-ghost" onClick={onClose}>Close</button>
          <button type="button" className="cand-export-submit" onClick={() => onExport(scope)}>
            <i className="ri-download-line" />Export Candidates
          </button>
        </div>
      </ModalBody>
    </Modal>
  );
}

// Trigger a browser download for an arbitrary Blob (CSV, XLSX, …) from an
// authenticated API response. Used by the Sample / Export endpoints so the
// generated file is always whatever the backend returned.
function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Import Candidates modal ────────────────────────────────────────────────
function ImportCandidatesModal({
  open, recruitment, onClose, onImport,
}: {
  open: boolean;
  recruitment: RecruitmentInfo | null;
  onClose: () => void;
  // Returns a promise so the parent can await the upload (the modal stays
  // open so the user can see in-flight state, but right now we just close it
  // when the parent finishes).
  onImport: (file: File) => Promise<void> | void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [linkedCode, setLinkedCode] = useState<string>('');
  const [importing, setImporting]   = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset on each open and prefill the linked recruitment to the currently
  // viewed one — the dropdown is read-only because the import is always
  // scoped to the recruitment whose page the user is on.
  useEffect(() => {
    if (open) {
      setFile(null);
      setLinkedCode(recruitment?.code || '');
      setImporting(false);
    }
  }, [open, recruitment]);

  const handlePick = (f: File | null | undefined) => {
    if (!f) return;
    const okExt = /\.(xlsx|xls|csv)$/i.test(f.name);
    if (!okExt) { alert('Please choose an .xlsx, .xls, or .csv file.'); return; }
    if (f.size > 10 * 1024 * 1024) { alert('File is larger than 10 MB.'); return; }
    setFile(f);
  };

  const handleSubmit = async () => {
    if (!file) { alert('Please choose a file to import.'); return; }
    setImporting(true);
    try {
      await onImport(file);
    } finally {
      setImporting(false);
    }
  };

  // The dropdown only knows the currently-loaded recruitment. The user can
  // type-in another code if they want to redirect this batch elsewhere — the
  // input is editable.
  const recruitmentOptions = recruitment
    ? [{ value: recruitment.code, label: `${recruitment.code} — ${recruitment.jobTitle}` }]
    : [];

  return (
    <Modal isOpen={open} toggle={onClose} centered size="md" backdrop="static" contentClassName="border-0 cand-import-modal">
      <ModalBody className="p-0" style={{ borderRadius: 16, overflow: 'hidden' }}>
        {/* Header */}
        <div className="cand-import-head">
          <span className="cand-import-head-icon">
            <i className="ri-upload-cloud-2-line" />
          </span>
          <div className="cand-import-head-text">
            <h5 className="mb-0">Import Candidates</h5>
            <div className="cand-import-head-sub">Upload an Excel or CSV file to bulk-add candidates</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="cand-import-close">
            <i className="ri-close-line" />
          </button>
        </div>

        {/* Body */}
        <div className="cand-import-body">
          <div className="cand-import-field">
            <label className="cand-import-label">
              Link Imported Candidates to Recruitment<span className="req">*</span>
            </label>
            <select
              className="cand-import-select"
              value={linkedCode}
              onChange={e => setLinkedCode(e.target.value)}
            >
              {recruitmentOptions.length === 0 ? (
                <option value="">— Select —</option>
              ) : recruitmentOptions.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <div className="cand-import-help">
              If a row contains a "Recruitment ID" column, that value overrides this default.
            </div>
          </div>

          <div className="cand-import-field">
            <label className="cand-import-label">
              Select Excel / CSV File<span className="req">*</span>
            </label>
            <div
              className={`cand-import-drop${file ? ' has-file' : ''}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); }}
              onDrop={e => { e.preventDefault(); handlePick(e.dataTransfer.files?.[0]); }}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
            >
              <span className="cand-import-drop-icon">
                <i className="ri-file-excel-2-line" />
              </span>
              <div className="cand-import-drop-text">
                <div className="cand-import-drop-title">
                  {file ? file.name : 'Click to choose Excel / CSV file'}
                </div>
                <div className="cand-import-drop-sub">
                  {file ? `${(file.size / 1024).toFixed(1)} KB` : 'Supports .xlsx, .xls, .csv · Max 10 MB'}
                </div>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                style={{ display: 'none' }}
                onChange={e => handlePick(e.target.files?.[0])}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="cand-import-footer">
          <button type="button" className="rec-btn-ghost" onClick={onClose}>Close</button>
          <button type="button" className="cand-import-submit" onClick={handleSubmit} disabled={!file || !linkedCode || importing}>
            {importing ? <Spinner size="sm" style={{ width: 14, height: 14 }} /> : <i className="ri-upload-2-line" />}
            {importing ? 'Importing…' : 'Import'}
          </button>
        </div>
      </ModalBody>
    </Modal>
  );
}

// ─── Sample Import Format modal ──────────────────────────────────────────────
function SampleImportFormatModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();

  // Display-only preview shown inside the modal — the actual file the user
  // downloads is generated by the backend (`GET /candidates/sample`) so
  // there's a single source of truth for the column names + dummy row.
  const COLUMNS = [
    'Name', 'Email', 'Mobile', 'Experience',
    'Current Salary', 'Expected Salary', 'Notice Period', 'Source',
  ];
  const SAMPLE_ROWS: string[][] = [
    ['Priya Sharma', 'priya.s@example.com', '+91 9812345678', '5',  '15', '22', '30 Days',  'LinkedIn'],
  ];

  const handleDownload = async () => {
    try {
      const res = await api.get('/candidates/sample', { responseType: 'blob' });
      triggerBlobDownload(res.data, 'candidates_sample.csv');
    } catch (err: any) {
      toast.error('Could not download sample', err?.response?.data?.message || 'Please try again.');
    }
  };

  return (
    <Modal isOpen={open} toggle={onClose} centered size="lg" backdrop="static" contentClassName="border-0 cand-sample-modal">
      <ModalBody className="p-0" style={{ borderRadius: 16, overflow: 'hidden' }}>
        {/* Header */}
        <div className="cand-sample-head">
          <span className="cand-sample-head-icon">
            <i className="ri-download-cloud-2-line" />
          </span>
          <div className="cand-sample-head-text">
            <h5 className="mb-0">Sample Import Format</h5>
            <div className="cand-sample-head-sub">Download an Excel template to bulk-upload candidates</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="cand-sample-close">
            <i className="ri-close-line" />
          </button>
        </div>

        {/* Body */}
        <div className="cand-sample-body">
          <p className="cand-sample-desc">
            The template contains the following columns. Fill each row with one candidate's
            information. Use the exact header names to avoid import errors.
          </p>

          <div className="cand-sample-table-wrap">
            <table className="cand-sample-table">
              <thead>
                <tr>{COLUMNS.map(c => <th key={c}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {SAMPLE_ROWS.map((row, i) => (
                  <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="cand-sample-note">
            <i className="ri-information-line" />
            <div>
              <strong>Notes:</strong> Experience / Current Salary / Expected Salary are numeric
              (years / LPA). Status must be one of: Applied, Screening, Interview R1, Interview R2,
              Final Interview, Selected, Rejected. Source must be one of: LinkedIn, Naukri, Indeed,
              Referral, Company Website, Walk-in, Job Fair, Other.
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="cand-sample-footer">
          <button type="button" className="rec-btn-ghost" onClick={onClose}>Close</button>
          <button type="button" className="cand-sample-download" onClick={handleDownload}>
            <i className="ri-download-line" />Download Sample
          </button>
        </div>
      </ModalBody>
    </Modal>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
/* ── CV cell ─────────────────────────────────────────────────────────────────
 * Renders one of two states inside the table's CV column:
 *
 *   - Upload chip (↑ arrow) when the candidate has no CV — clicking it opens
 *     a hidden <input type="file"> and PATCHes the row with the chosen file.
 *   - Download chip (↓ arrow) once a CV is on file — links straight to the
 *     server-rendered cv_url.
 *
 * Upload state is local to the cell so two rows can upload in parallel
 * without one cell's spinner bleeding into another.
 */
function CvCell({
  candidate, onUploaded,
}: {
  candidate: CandidateRow;
  onUploaded: (updated: CandidateRow) => void;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  // Already-uploaded → render the green download chip. The cv_url points
  // at the Laravel route /api/candidates/{id}/cv (works regardless of
  // Apache's DocumentRoot); we append the sanctum token here so a plain
  // anchor click can authenticate without an Authorization header.
  if (candidate.cv_url) {
    const token = localStorage.getItem('cbc_token') || '';
    const sep   = candidate.cv_url.includes('?') ? '&' : '?';
    const href  = `${candidate.cv_url}${sep}token=${encodeURIComponent(token)}`;
    return (
      <a href={href} target="_blank" rel="noreferrer" className="cand-cv-chip" download>
        <i className="ri-download-line" /><span>CV</span>
      </a>
    );
  }

  const handleFile = async (file: File | null | undefined) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File too large', 'CV must be under 10 MB.');
      return;
    }
    setUploading(true);
    try {
      // FormData + _method=PUT is Laravel's pattern for multipart updates.
      const fd = new FormData();
      fd.append('_method', 'PUT');
      fd.append('cv', file);
      const { data } = await api.post(`/candidates/${candidate.id}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onUploaded(data);
      toast.success('CV uploaded', `${candidate.name}'s CV saved.`);
    } catch (err: any) {
      toast.error('Upload failed', err?.response?.data?.message
        || err?.response?.data?.errors?.cv?.[0]
        || 'Please try a PDF/DOC/DOCX under 10 MB.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <label
      className="cand-cv-chip"
      // Override the green "downloaded" tone so the upload state reads as a
      // clear call-to-action, not a "CV already attached" affordance.
      style={{
        cursor: uploading ? 'progress' : 'pointer',
        background: uploading ? '#e0e7ff' : '#eef2ff',
        color: '#4338ca',
        border: '1px dashed #c7d2fe',
      }}
      title="Upload CV"
    >
      {uploading
        ? <Spinner size="sm" style={{ width: 12, height: 12 }} />
        : <i className="ri-upload-2-line" />}
      <span>{uploading ? 'Uploading…' : 'Upload'}</span>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.doc,.docx"
        style={{ display: 'none' }}
        disabled={uploading}
        onChange={e => handleFile(e.target.files?.[0])}
      />
    </label>
  );
}

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div className="cand-field">
      <div className="cand-field-label">{label}</div>
      <div className="cand-field-value">{value || <span className="text-muted">—</span>}</div>
    </div>
  );
}

// ─── Add / Edit Candidate modal ──────────────────────────────────────────────
function CandidateFormModal({
  open, editing, recruitmentId, recruitment, onClose, onSaved,
}: {
  open: boolean;
  editing: CandidateRow | null;
  recruitmentId: number | null;
  recruitment: RecruitmentInfo | null;
  onClose: () => void;
  onSaved: (row: CandidateRow) => void;
}) {
  const toast = useToast();

  const [name, setName]                       = useState('');
  const [email, setEmail]                     = useState('');
  const [mobile, setMobile]                   = useState('');
  const [address, setAddress]                 = useState('');
  const [qualification, setQualification]     = useState('');
  const [experience, setExperience]           = useState('0');
  const [transport, setTransport]             = useState('');
  const [distance, setDistance]               = useState('');
  const [currentSalary, setCurrentSalary]     = useState('');
  const [expectedSalary, setExpectedSalary]   = useState('');
  const [noticePeriod, setNoticePeriod]       = useState('Immediate');
  const [source, setSource]                   = useState('');
  const [status, setStatus]                   = useState<CandidateStatus>('Applied');
  const [cvFile, setCvFile]                   = useState<File | null>(null);
  const [errors, setErrors]                   = useState<Record<string, string>>({});
  const [saving, setSaving]                   = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setEmail(editing.email || '');
      setMobile(editing.mobile || '');
      setAddress(editing.current_address || '');
      setQualification(editing.qualification || '');
      setExperience(String(editing.experience_years ?? 0));
      setTransport(editing.mode_of_transport || '');
      setDistance(editing.distance_km != null ? String(editing.distance_km) : '');
      setCurrentSalary(editing.current_salary_lpa != null ? String(editing.current_salary_lpa) : '');
      setExpectedSalary(editing.expected_salary_lpa != null ? String(editing.expected_salary_lpa) : '');
      setNoticePeriod(editing.notice_period || 'Immediate');
      setSource(editing.source || '');
      setStatus(editing.status);
    } else {
      setName(''); setEmail(''); setMobile(''); setAddress(''); setQualification('');
      setExperience('0'); setTransport(''); setDistance('');
      setCurrentSalary(''); setExpectedSalary(''); setNoticePeriod('Immediate');
      setSource(''); setStatus('Applied');
    }
    setCvFile(null);
    setErrors({});
  }, [open, editing]);

  const handleSubmit = async () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Name is required';
    if (!recruitmentId) errs.recruitment_id = 'Recruitment is required';
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    const fd = new FormData();
    fd.append('recruitment_id', String(recruitmentId));
    fd.append('name', name.trim());
    if (email)          fd.append('email', email.trim());
    if (mobile)         fd.append('mobile', mobile.trim());
    if (address)        fd.append('current_address', address.trim());
    if (qualification)  fd.append('qualification', qualification.trim());
    fd.append('experience_years', experience || '0');
    if (transport)      fd.append('mode_of_transport', transport);
    if (distance)       fd.append('distance_km', distance);
    if (currentSalary)  fd.append('current_salary_lpa', currentSalary);
    if (expectedSalary) fd.append('expected_salary_lpa', expectedSalary);
    if (noticePeriod)   fd.append('notice_period', noticePeriod);
    if (source)         fd.append('source', source);
    fd.append('status', status);
    if (cvFile)         fd.append('cv', cvFile);

    setSaving(true);
    try {
      const isEdit = editing != null;
      const url = isEdit ? `/candidates/${editing!.id}` : '/candidates';
      // FormData requires POST + _method=PUT for Laravel updates with files.
      if (isEdit) fd.append('_method', 'PUT');
      const { data } = await api.post(url, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success(isEdit ? 'Candidate updated' : 'Candidate added', `${data.name} saved successfully.`);
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

  return (
    <Modal isOpen={open} toggle={onClose} centered size="lg" backdrop="static" modalClassName="rec-form-modal" contentClassName="rec-form-content border-0">
      <ModalBody className="p-0">
        <div className="rec-form-header">
          <div className="d-flex align-items-center justify-content-between gap-3">
            <div className="d-flex align-items-center gap-2">
              <span style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(255,255,255,0.18)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <i className="ri-user-add-line" style={{ fontSize: 16 }} />
              </span>
              <div>
                <h5 className="fw-bold mb-0" style={{ color: '#fff', fontSize: 15, lineHeight: 1.2 }}>Candidate Details</h5>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', marginTop: 1 }}>{editing ? 'Update applicant profile' : 'Register a new applicant profile in the pipeline'}</div>
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="rec-close-btn">
              <i className="ri-close-line" />
            </button>
          </div>
        </div>

        <div className="rec-form-body">
          {/* Linked Recruitment readout */}
          <div className="cand-linked-recruitment mb-2">
            <span className="cand-linked-icon"><i className="ri-link" /></span>
            <span className="cand-linked-label">Linked Recruitment</span>
            <span className="cand-linked-value">{recruitment ? `${recruitment.code} — ${recruitment.jobTitle}` : '—'}</span>
          </div>

          <div className="rec-form-card">
            {/* Section 1: Candidate Basic Details */}
            <div className="rec-form-section">
              <div className="rec-form-section-head">
                <span className="cand-step">1</span>
                <p className="rec-form-section-title">Candidate Basic Details</p>
              </div>
              <Row className="g-2">
                <Col md={4}>
                  <label className="rec-form-label">Name<span className="req">*</span></label>
                  <input type="text" className={`rec-input${errors.name ? ' is-invalid' : ''}`} placeholder="Full name" value={name} onChange={e => setName(e.target.value)} />
                  {errors.name && <div className="rec-error"><i className="ri-error-warning-line" />{errors.name}</div>}
                </Col>
                <Col md={4}>
                  <label className="rec-form-label">Email</label>
                  <input type="email" className="rec-input" placeholder="name@email.com" value={email} onChange={e => setEmail(e.target.value)} />
                </Col>
                <Col md={4}>
                  <label className="rec-form-label">Mobile Number</label>
                  <input type="text" className="rec-input" placeholder="+91 9XXXXXXXXX" value={mobile} onChange={e => setMobile(e.target.value)} />
                </Col>
                <Col md={6}>
                  <label className="rec-form-label">Current Address</label>
                  <input type="text" className="rec-input" placeholder="Full residential address" value={address} onChange={e => setAddress(e.target.value)} />
                </Col>
                <Col md={6}>
                  <label className="rec-form-label">Qualification</label>
                  <input type="text" className="rec-input" placeholder="e.g. B.Tech Computer Science" value={qualification} onChange={e => setQualification(e.target.value)} />
                </Col>
                <Col md={4}>
                  <label className="rec-form-label">Experience (Years)</label>
                  <input type="number" min={0} step={0.5} className="rec-input" value={experience} onChange={e => setExperience(e.target.value)} />
                </Col>
                <Col md={4}>
                  <label className="rec-form-label">Mode of Transport</label>
                  <MasterSelect value={transport} onChange={setTransport} options={TRANSPORT_MODES.map(m => ({ value: m, label: m }))} placeholder="— Select —" />
                </Col>
                <Col md={4}>
                  <label className="rec-form-label">Distance (KM)</label>
                  <input type="number" min={0} step={0.1} className="rec-input" placeholder="e.g. 12" value={distance} onChange={e => setDistance(e.target.value)} />
                </Col>
              </Row>
            </div>

            {/* Section 2: Compensation Details */}
            <div className="rec-form-section">
              <div className="rec-form-section-head">
                <span className="cand-step cand-step-2">2</span>
                <p className="rec-form-section-title">Compensation Details</p>
              </div>
              <Row className="g-2">
                <Col md={4}>
                  <label className="rec-form-label">Current Salary (LPA)</label>
                  <input type="number" min={0} step={0.5} className="rec-input" placeholder="e.g. 10" value={currentSalary} onChange={e => setCurrentSalary(e.target.value)} />
                </Col>
                <Col md={4}>
                  <label className="rec-form-label">Expected Salary (LPA)</label>
                  <input type="number" min={0} step={0.5} className="rec-input" placeholder="e.g. 15" value={expectedSalary} onChange={e => setExpectedSalary(e.target.value)} />
                </Col>
                <Col md={4}>
                  <label className="rec-form-label">Notice Period</label>
                  <MasterSelect value={noticePeriod} onChange={setNoticePeriod} options={NOTICE_PERIODS.map(m => ({ value: m, label: m }))} placeholder="— Select —" />
                </Col>
              </Row>
            </div>

            {/* Section 3 + 4 + 5 in one row */}
            <Row className="g-2 mt-1">
              <Col md={4}>
                <div className="rec-form-section h-100" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
                  <div className="rec-form-section-head">
                    <span className="cand-step cand-step-3">3</span>
                    <p className="rec-form-section-title">Source of Application</p>
                  </div>
                  <label className="rec-form-label">Source<span className="req">*</span></label>
                  <MasterSelect value={source} onChange={setSource} options={SOURCES.map(s => ({ value: s, label: s }))} placeholder="— Select —" />
                </div>
              </Col>
              <Col md={4}>
                <div className="rec-form-section h-100" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
                  <div className="rec-form-section-head">
                    <span className="cand-step cand-step-4">4</span>
                    <p className="rec-form-section-title">Attachment Details</p>
                  </div>
                  <label className="rec-form-label">Upload CV<span className="req">*</span></label>
                  <label className="cand-cv-drop">
                    <input type="file" accept=".pdf,.doc,.docx" onChange={e => setCvFile(e.target.files?.[0] ?? null)} style={{ display: 'none' }} />
                    <i className="ri-attachment-2" />
                    <span className="cand-cv-text">
                      <strong>{cvFile ? cvFile.name : 'Attach CV'}</strong>
                      <span>PDF, DOC, DOCX · Max 10 MB</span>
                    </span>
                  </label>
                </div>
              </Col>
              <Col md={4}>
                <div className="rec-form-section h-100" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
                  <div className="rec-form-section-head">
                    <span className="cand-step cand-step-5">5</span>
                    <p className="rec-form-section-title">Recruitment Status</p>
                  </div>
                  <label className="rec-form-label">Candidate Status<span className="req">*</span></label>
                  <MasterSelect value={status} onChange={(v) => setStatus(v as CandidateStatus)} options={STATUSES.map(s => ({ value: s, label: s }))} placeholder="— Select —" />
                </div>
              </Col>
            </Row>
          </div>
        </div>

        <div className="rec-form-footer">
          <span className="hint"><i className="ri-information-line align-bottom" /> All fields marked <span style={{ color: '#f06548', fontWeight: 700 }}>*</span> are required</span>
          <div className="d-flex gap-2">
            <button type="button" className="rec-btn-ghost" onClick={onClose} disabled={saving}>
              <i className="ri-close-line" />Close
            </button>
            <button type="button" className="rec-btn-primary" onClick={handleSubmit} disabled={saving}>
              {saving ? (<><Spinner size="sm" style={{ width: 14, height: 14 }} /><span>Saving…</span></>) : (<><i className="ri-check-line" />Submit</>)}
            </button>
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
}

// ─── Confirm Selection / Confirm Rejection modal ────────────────────────────
const REJECTION_REASONS = [
  { value: 'Not a culture fit',                  label: 'Not a culture fit' },
  { value: 'Skills mismatch',                    label: 'Skills mismatch' },
  { value: 'Insufficient experience',            label: 'Insufficient experience' },
  { value: 'Salary expectations out of range',   label: 'Salary expectations out of range' },
  { value: 'Notice period too long',             label: 'Notice period too long' },
  { value: 'Withdrew from process',              label: 'Withdrew from process' },
  { value: 'Position filled internally',         label: 'Position filled internally' },
  { value: 'Other',                              label: 'Other (add notes below)' },
];

function CandidateConfirmModal({
  target, onClose, onConfirm,
}: {
  target: { row: CandidateRow; mode: 'select' | 'reject' } | null;
  onClose: () => void;
  onConfirm: (reasonOrNote: string) => void;
}) {
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [reasonErr, setReasonErr] = useState(false);

  // Reset form whenever a new candidate / mode is targeted.
  useEffect(() => {
    if (target) { setNotes(''); setReason(''); setReasonErr(false); }
  }, [target]);

  if (!target) return null;
  const { row, mode } = target;
  const isReject = mode === 'reject';
  const stage = STATUS_TONES[row.status];

  const handleConfirm = () => {
    if (isReject && !reason) { setReasonErr(true); return; }
    const payload = isReject ? [reason, notes].filter(Boolean).join(' — ') : notes;
    onConfirm(payload);
  };

  return (
    <Modal isOpen={!!target} toggle={onClose} centered size="md" backdrop="static" contentClassName={`border-0 cand-confirm-modal cand-confirm-modal--${isReject ? 'reject' : 'select'}`}>
      <ModalBody className="p-0" style={{ borderRadius: 16, overflow: 'hidden' }}>
        {/* Header */}
        <div className="cand-confirm-head">
          <span className="cand-confirm-head-icon">
            <i className={isReject ? 'ri-close-line' : 'ri-check-line'} />
          </span>
          <div className="cand-confirm-head-text">
            <h5 className="mb-0">{isReject ? 'Confirm Rejection' : 'Confirm Selection'}</h5>
            <div className="cand-confirm-head-sub">
              {isReject
                ? 'This will mark the candidate as Rejected — moves to Rejected tab'
                : 'This will mark the candidate as Selected'}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="cand-confirm-close">
            <i className="ri-close-line" />
          </button>
        </div>

        {/* Body */}
        <div className="cand-confirm-body">
          {/* Candidate summary card */}
          <div className="cand-confirm-summary">
            <div
              className="cand-confirm-avatar"
              style={{ background: `linear-gradient(135deg, ${row.accent}, ${row.accent}cc)` }}
            >
              {row.initials}
            </div>
            <div className="cand-confirm-summary-text">
              <div className="cand-confirm-name">{row.name}</div>
              <div className="cand-confirm-meta">
                <span>{row.email || '—'}</span>
                {row.recruitment_code && (
                  <>
                    <span className="dot">·</span>
                    <span className="rec-id-pill">{row.recruitment_code}</span>
                  </>
                )}
              </div>
            </div>
            <div className="cand-confirm-stage">
              <div className="cand-confirm-stage-label">Current Stage</div>
              <span className="rec-pill" style={{ background: stage.bg, color: stage.fg }}>{row.status}</span>
            </div>
          </div>

          {isReject && (
            <div className="cand-confirm-field">
              <label className="cand-confirm-label">
                Reason for Rejection<span className="req">*</span>
              </label>
              <select
                className={`cand-confirm-select${reasonErr ? ' is-invalid' : ''}`}
                value={reason}
                onChange={e => { setReason(e.target.value); if (e.target.value) setReasonErr(false); }}
              >
                <option value="">— Select a reason —</option>
                {REJECTION_REASONS.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              {reasonErr && (
                <div className="cand-confirm-error">
                  <i className="ri-error-warning-line" />Please select a reason before confirming
                </div>
              )}
            </div>
          )}

          <div className="cand-confirm-field">
            <label className="cand-confirm-label">
              Notes <span className="opt">(OPTIONAL)</span>
            </label>
            <textarea
              className="cand-confirm-textarea"
              rows={2}
              placeholder="Add context for the audit trail"
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="cand-confirm-footer">
          <button type="button" className="rec-btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="cand-confirm-submit" onClick={handleConfirm}>
            <i className={isReject ? 'ri-close-line' : 'ri-check-line'} />
            {isReject ? 'Confirm Rejection' : 'Confirm Selection'}
          </button>
        </div>
      </ModalBody>
    </Modal>
  );
}

